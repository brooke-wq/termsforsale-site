// Netlify function / scheduled poller: follow-up-nudge
// Designed to run every 30 minutes on the DigitalOcean Droplet via cron.
// Also callable as POST /api/follow-up-nudge for manual trigger.
//
// Scans GHL for contacts tagged lead-warm or lead-hot that have NOT been
// tagged follow-up-sent. If 7+ days since last activity: generates a
// personalized SMS via Claude, sends it, and tags the contact.
// If 14+ days after follow-up with no response: marks lead-stale.
//
// ENV VARS: ANTHROPIC_API_KEY, GHL_API_KEY, GHL_LOCATION_ID_ACQASSIST (or GHL_LOCATION_ID), BROOKE_PHONE

const { complete } = require('./_claude');
const { cfMap, getContact, postNote, addTags, swapTags, sendSMS, findByTag } = require('./_ghl');

// File-based dedup (Droplet only)
var sentLog;
try { sentLog = require('../../../jobs/sent-log'); } catch(e) { sentLog = null; }

const SMS_SYSTEM = `You are a friendly real estate follow-up assistant for Deal Pros LLC.
Write a single follow-up SMS message to a seller who submitted a property lead but hasn't responded recently.
Rules:
- Under 160 characters total (hard limit)
- Mention the property address briefly (street only, no city/state)
- Reference their motivation if provided
- Friendly, not pushy — just checking in
- End with a soft question to invite a reply
- No emojis, no ALL CAPS
- Sign off as "Deal Pros" or "Brooke at Deal Pros"`;

// How many days of inactivity before sending follow-up
var NUDGE_AFTER_DAYS = 7;
// How many days after follow-up before marking stale
var STALE_AFTER_DAYS = 14;

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  var ghlKey       = process.env.GHL_API_KEY;
  var locationId   = process.env.GHL_LOCATION_ID_ACQASSIST || process.env.GHL_LOCATION_ID;
  var brookePhone  = process.env.BROOKE_PHONE;

  if (!anthropicKey || !ghlKey || !locationId) {
    return respond(500, { error: 'Missing required env vars' });
  }

  var stats = { scanned: 0, nudged: 0, staled: 0, errors: [] };

  try {
    // Fetch warm and hot leads
    var warmRes = await findByTag(ghlKey, locationId, 'lead-warm');
    var hotRes  = await findByTag(ghlKey, locationId, 'lead-hot');

    var warmContacts = (warmRes.body && warmRes.body.contacts) || [];
    var hotContacts  = (hotRes.body && hotRes.body.contacts) || [];

    // Combine and deduplicate by contact id
    var seen = {};
    var allContacts = [];
    warmContacts.concat(hotContacts).forEach(function(c) {
      if (c.id && !seen[c.id]) {
        seen[c.id] = true;
        allContacts.push(c);
      }
    });

    console.log('[follow-up-nudge] found ' + allContacts.length + ' warm/hot contacts');

    var now = Date.now();

    for (var i = 0; i < allContacts.length; i++) {
      var contact = allContacts[i];
      stats.scanned++;

      try {
        var tags = (contact.tags || []).map(function(t) { return t.toLowerCase ? t.toLowerCase() : t; });

        // REQUIRED: skip any contact without the "opt in" tag (case-insensitive).
        // Campaign sends require explicit opt-in regardless of lead temperature.
        // Stale tagging (Path A below) is data-only and still runs.
        var hasOptIn = tags.indexOf('opt in') !== -1;

        // --- Path A: Already sent follow-up, check for stale ---
        if (tags.indexOf('follow-up-sent') !== -1) {
          // Check if already stale-tagged
          if (tags.indexOf('lead-stale') !== -1) continue;

          // Find when the follow-up was sent by checking dateUpdated or dateAdded
          var followUpDate = contact.dateUpdated || contact.dateAdded;
          if (!followUpDate) continue;

          var daysSinceFollowUp = (now - new Date(followUpDate).getTime()) / (1000 * 60 * 60 * 24);

          if (daysSinceFollowUp >= STALE_AFTER_DAYS) {
            console.log('[follow-up-nudge] marking stale: ' + contact.id + ' (' + (contact.firstName || '') + ' ' + (contact.lastName || '') + ')');
            await addTags(ghlKey, contact.id, ['lead-stale']);
            await postNote(ghlKey, contact.id,
              'Auto-stale: No response ' + Math.round(daysSinceFollowUp) + ' days after follow-up SMS. Moved to stale.\n--- Follow-Up Nudge Agent / Deal Pros LLC ---');
            stats.staled++;
          }
          continue;
        }

        // --- Path B: No follow-up sent yet, check if nudge is due ---
        var lastActivity = contact.dateUpdated || contact.dateAdded;
        if (!lastActivity) continue;

        var daysSinceActivity = (now - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceActivity < NUDGE_AFTER_DAYS) continue;

        // File-based dedup: skip if already nudged this contact
        if (sentLog && sentLog.isDroplet() && sentLog.wasSent(contact.id, 'nudge', 'sent')) {
          console.log('[follow-up-nudge] skipping ' + contact.id + ' — already nudged (file dedup)');
          continue;
        }

        // Need phone to send SMS
        var phone = contact.phone;
        if (!phone) {
          console.log('[follow-up-nudge] skipping ' + contact.id + ' — no phone');
          continue;
        }

        // Gate the send on the "opt in" tag. Computed at the top of the loop.
        if (!hasOptIn) {
          console.log('[follow-up-nudge] skipping ' + contact.id + ' — no opt in tag');
          continue;
        }

        // Extract property info from custom fields
        var fields = cfMap(contact);
        var propertyAddress = fields.property_address || fields.full_address || '';
        var motivation = fields.seller_motivation || fields.motivation || '';

        // Generate personalized SMS via Claude
        var userPrompt = 'Write a follow-up SMS for this seller:\n' +
          'Name: ' + (contact.firstName || 'there') + '\n' +
          'Property: ' + (propertyAddress || 'their property') + '\n' +
          'Motivation: ' + (motivation || 'not specified') + '\n' +
          'Days since last contact: ' + Math.round(daysSinceActivity) + '\n\n' +
          'Return ONLY the SMS text, nothing else. Must be under 160 characters.';

        var claudeRes = await complete(anthropicKey, {
          system: SMS_SYSTEM,
          user: userPrompt,
          maxTokens: 100
        });

        var smsText = (claudeRes.text || '').trim();
        // Hard limit enforcement
        if (smsText.length > 160) {
          smsText = smsText.slice(0, 157) + '...';
        }

        if (!smsText) {
          console.error('[follow-up-nudge] empty SMS generated for ' + contact.id);
          continue;
        }

        console.log('[follow-up-nudge] sending SMS to ' + contact.id + ': ' + smsText);

        // Send SMS
        var smsRes = await sendSMS(ghlKey, locationId, phone, smsText);
        if (smsRes.status >= 400) {
          console.error('[follow-up-nudge] SMS send failed for ' + contact.id + ': ' + JSON.stringify(smsRes.body));
          stats.errors.push({ contactId: contact.id, error: 'SMS send failed: ' + smsRes.status });
          continue;
        }

        // Tag and note
        await addTags(ghlKey, contact.id, ['follow-up-sent']);
        await postNote(ghlKey, contact.id,
          'Auto follow-up sent: ' + smsText + '\n\n' +
          'Days inactive: ' + Math.round(daysSinceActivity) +
          '\n--- Follow-Up Nudge Agent / Deal Pros LLC ---');
        if (sentLog && sentLog.isDroplet()) sentLog.markSent(contact.id, 'nudge', 'sent');

        stats.nudged++;
        console.log('[follow-up-nudge] nudged ' + contact.id + ' cost=$' + claudeRes.usage.cost.toFixed(6));

      } catch (contactErr) {
        console.error('[follow-up-nudge] error on contact ' + contact.id + ':', contactErr.message);
        stats.errors.push({ contactId: contact.id, error: contactErr.message });
        // Continue to next contact — don't crash the whole run
      }
    }

    console.log('[follow-up-nudge] done. scanned=' + stats.scanned +
      ' nudged=' + stats.nudged + ' staled=' + stats.staled +
      ' errors=' + stats.errors.length);

    return respond(200, {
      success: true,
      stats: stats
    });

  } catch (err) {
    console.error('[follow-up-nudge] fatal error:', err.message);
    return respond(500, { error: err.message, stats: stats });
  }
};

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
  };
}
