// Netlify function: lead-intake
// POST /api/lead-intake
// Receives seller lead data, Claude scores 1-50 across 5 dimensions,
// routes hot leads to underwriting, flags escalations to Brooke via SMS.
//
// ENV VARS: ANTHROPIC_API_KEY, GHL_API_KEY, GHL_LOCATION_ID_ACQASSIST, BROOKE_PHONE

const { complete } = require('./_claude');
const { postNote, addTags, swapTags, updateCustomFields, upsertContact, sendSMS } = require('./_ghl');

const SCORING_SYSTEM = `You are the Lead Intake Agent for Deal Pros LLC, a real estate wholesale and creative finance company.

Score this seller lead on a scale of 1-50 total (sum of 5 categories, each 1-10):
1. MOTIVATION (1-10): How motivated is the seller? Look for: inherited, divorce, pre-foreclosure, tax issues, relocation, tired landlord, health issues.
2. TIMELINE (1-10): How urgent? 30 days or less = 8-10. 60 days = 5-7. 90+ days = 1-4. No timeline = 3.
3. EQUITY (1-10): Estimated equity vs property value. 40%+ = 8-10. 20-40% = 5-7. Under 20% = 1-4. Free & clear = 10.
4. CONDITION (1-10): Property condition. Excellent/Good = 8-10. Fair = 5-7. Poor/needs rehab = 3-5. Unknown = 4.
5. COMMUNICATION (1-10): Responsiveness, detail provided, willingness to share info. Rich detail = 8-10. Sparse = 3-5. Minimal = 1-3.

TIER ASSIGNMENT:
- HOT (35-50): High motivation + short timeline + equity. Fast-track to underwriting.
- WARM (20-34): Some indicators present but not all aligned. Nurture sequence.
- COOL (1-19): Low motivation or no real opportunity. File and check back.

RECOMMENDED STRUCTURE: Based on the data, suggest the best acquisition structure:
Cash, Subject-To, Seller Finance, Morby Method, Hybrid, Novation, Lease Option, or "Need more info"

FLAGS: If you detect any of these, set the corresponding flag:
- bankruptcy, probate, divorce, legal-issue, tax-lien, lis-pendens, minor-heir

Respond with valid JSON only.`;

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  var ghlKey       = process.env.GHL_API_KEY;
  var locationId   = process.env.GHL_LOCATION_ID_ACQASSIST || process.env.GHL_LOCATION_ID;
  var brookePhone  = process.env.BROOKE_PHONE;

  if (!anthropicKey || !ghlKey) {
    return respond(500, { error: 'Missing required env vars' });
  }

  var body;
  try { body = JSON.parse(event.body); } catch(e) {
    return respond(400, { error: 'Invalid JSON' });
  }

  var address   = body.address || body.property_address || '';
  var city      = body.city || body.property_city || '';
  var state     = body.state || body.property_state || '';
  var contactId = body.contact_id || body.contactId || null;

  if (!address && !contactId) {
    return respond(400, { error: 'address or contact_id required' });
  }

  try {
    // If no contact_id, upsert into GHL first
    if (!contactId && locationId) {
      var upsertRes = await upsertContact(ghlKey, locationId, {
        firstName: body.firstName || body.first_name || 'Seller',
        lastName:  body.lastName || body.last_name || address.split(' ').slice(0, 2).join(' '),
        phone:     body.phone || undefined,
        email:     body.email || undefined,
        source:    'Lead Intake',
        customFields: [
          { key: 'property_address', field_value: address },
          { key: 'property_city', field_value: city },
          { key: 'property_state', field_value: state }
        ].filter(function(f) { return f.field_value; })
      });
      if (upsertRes.body && (upsertRes.body.contact || upsertRes.body.id)) {
        contactId = (upsertRes.body.contact && upsertRes.body.contact.id) || upsertRes.body.id;
        console.log('[lead-intake] upserted contact: ' + contactId);
      }
    }

    // Build lead summary for Claude
    var leadData = [
      'Address: ' + [address, city, state].filter(Boolean).join(', '),
      'Seller Motivation: ' + (body.seller_motivation || body.motivation || 'Not provided'),
      'Timeline: ' + (body.seller_timeline || body.timeline || 'Not provided'),
      'Equity Estimate: ' + (body.seller_equity_estimate || body.equity || 'Not provided'),
      'Mortgage Balance: ' + (body.mortgage_balance || body.seller_mortgage_balance || 'Not provided'),
      'Property Condition: ' + (body.property_condition || body.condition || 'Not provided'),
      'Beds/Baths/Sqft: ' + [body.beds, body.baths, body.sqft].filter(Boolean).join('/'),
      'Year Built: ' + (body.year_built || 'Not provided'),
      'Agent Status: ' + (body.seller_agent_status || body.agent_status || 'Not provided'),
      'Additional Notes: ' + (body.notes || body.additional_notes || 'None')
    ].join('\n');

    var userPrompt = 'Score this seller lead:\n\n' + leadData + '\n\n' +
      'Return JSON: { "scores": { "motivation": N, "timeline": N, "equity": N, "condition": N, "communication": N }, "score": N, "tier": "hot|warm|cool", "recommended_structure": "...", "summary": "2-3 sentence summary", "flags": ["flag1"] }';

    console.log('[lead-intake] scoring: ' + address);
    var claudeRes = await complete(anthropicKey, {
      system: SCORING_SYSTEM,
      user: userPrompt,
      maxTokens: 600,
      json: true
    });
    var result = claudeRes.text;

    console.log('[lead-intake] score=' + result.score + ' tier=' + result.tier +
      ' structure=' + result.recommended_structure +
      ' cost=$' + claudeRes.usage.cost.toFixed(6));

    // Update GHL contact
    if (contactId && ghlKey) {
      // Set custom fields
      await updateCustomFields(ghlKey, contactId, [
        { key: 'lead_score', field_value: String(result.score || 0) },
        { key: 'deal_structure', field_value: result.recommended_structure || '' }
      ]);

      // Post intake note
      var noteBody = '--- LEAD INTAKE REPORT ---\n' +
        'Score: ' + result.score + '/50 (' + (result.tier || '').toUpperCase() + ')\n' +
        'Motivation: ' + (result.scores && result.scores.motivation || '?') + '/10\n' +
        'Timeline: ' + (result.scores && result.scores.timeline || '?') + '/10\n' +
        'Equity: ' + (result.scores && result.scores.equity || '?') + '/10\n' +
        'Condition: ' + (result.scores && result.scores.condition || '?') + '/10\n' +
        'Communication: ' + (result.scores && result.scores.communication || '?') + '/10\n\n' +
        'Recommended Structure: ' + (result.recommended_structure || 'TBD') + '\n' +
        'Summary: ' + (result.summary || '') + '\n' +
        (result.flags && result.flags.length ? '\nFLAGS: ' + result.flags.join(', ') : '') +
        '\n\n--- Lead Intake Agent / Deal Pros LLC ---';
      await postNote(ghlKey, contactId, noteBody);

      // Apply tier tag
      var tierTag = 'lead-' + (result.tier || 'cool');
      var tagsToAdd = [tierTag, 'lead-scored'];
      var tagsToRemove = ['lead-new', 'lead-unscored'];

      // Hot lead: auto-trigger underwriting
      if (result.tier === 'hot' && result.score >= 35) {
        tagsToAdd.push('uw-requested');
        console.log('[lead-intake] HOT lead — auto-triggering underwriting');
      }

      // Flag escalation
      if (result.flags && result.flags.length > 0) {
        tagsToAdd.push('flag-escalate');
        result.flags.forEach(function(f) { tagsToAdd.push('flag-' + f); });

        // SMS alert to Brooke
        if (brookePhone && locationId) {
          var flagMsg = 'LEAD FLAG: ' + address + ' — ' + result.flags.join(', ') +
            ' | Score: ' + result.score + '/50';
          if (flagMsg.length > 155) flagMsg = flagMsg.slice(0, 152) + '...';
          await sendSMS(ghlKey, locationId, brookePhone, flagMsg);
          console.log('[lead-intake] flag SMS sent to Brooke');
        }
      }

      await swapTags(ghlKey, contactId, tagsToRemove, tagsToAdd);
    }

    return respond(200, {
      success: true,
      address: [address, city, state].filter(Boolean).join(', '),
      contactId: contactId,
      score: result.score,
      tier: result.tier,
      recommended_structure: result.recommended_structure,
      summary: result.summary,
      flags: result.flags || [],
      usage: claudeRes.usage
    });

  } catch (err) {
    console.error('[lead-intake] error:', err.message);
    // Post error note if we have a contact
    if (contactId && ghlKey) {
      try { await postNote(ghlKey, contactId, 'Lead Intake ERROR: ' + err.message); } catch(e) {}
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
