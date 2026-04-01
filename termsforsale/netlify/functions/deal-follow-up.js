// Netlify function: deal-follow-up.js
// Runs every 30 min on DigitalOcean Droplet.
// Implements a 3-day Deal Interest Sprint for matched buyers.
//
// Day 0: SMS 1 (1/2/3 reply) + Email 1 (IN/MAYBE/PASS)
// Day 1: SMS 2 for non-responders ("Still buying in [city]?")
// Day 2: Email 2 (final pulse) + SMS 3 (A/B/C permission pass)
//
// Tags used:
//   alerted-XXXXXXXX  — initial deal alert sent (set by notify-buyers)
//   sprint-d0-XXXXXXXX — Day 0 follow-up sent
//   sprint-d1-XXXXXXXX — Day 1 follow-up sent
//   sprint-d2-XXXXXXXX — Day 2 follow-up sent
//   deal-hot / deal-warm / deal-paused — buyer response tags
//
// ENV VARS: GHL_API_KEY, GHL_LOCATION_ID, NOTION_TOKEN, NOTION_DB_ID

const GHL_BASE = 'https://services.leadconnectorhq.com';

async function ghlRequest(apiKey, method, path, body) {
  var opts = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(GHL_BASE + path, opts);
  var text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch(e) { return { status: res.status, body: text }; }
}

exports.handler = async function(event) {
  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    console.error('[deal-follow-up] Missing env vars');
    return { statusCode: 500 };
  }

  console.log('[deal-follow-up] Starting follow-up sprint scan...');

  try {
    // Find all contacts with alerted-* tags (they received a deal alert)
    var contacts = await findAlertedContacts(apiKey, locationId);
    if (!contacts.length) {
      console.log('[deal-follow-up] No alerted contacts to follow up.');
      return { statusCode: 200 };
    }

    var stats = { d0: 0, d1: 0, d2: 0, skipped: 0 };
    var now = Date.now();

    for (var i = 0; i < contacts.length; i++) {
      var contact = contacts[i];
      var tags = contact.tags || [];

      // Find all alerted-* tags to know which deals they were sent
      var alertedTags = tags.filter(function(t) { return t.startsWith('alerted-'); });
      if (!alertedTags.length) continue;

      for (var j = 0; j < alertedTags.length; j++) {
        var dealTag = alertedTags[j]; // e.g. "alerted-330090d6"
        var dealId = dealTag.replace('alerted-', '');
        var d0Tag = 'sprint-d0-' + dealId;
        var d1Tag = 'sprint-d1-' + dealId;
        var d2Tag = 'sprint-d2-' + dealId;

        // Check if buyer already responded (hot/warm/paused)
        var responded = tags.indexOf('deal-hot') > -1 || tags.indexOf('deal-warm') > -1 || tags.indexOf('deal-paused') > -1;
        if (responded) { stats.skipped++; continue; }

        // Get the alert timestamp from contact's dateUpdated (approximate)
        var alertTime = new Date(contact.dateUpdated || contact.dateAdded).getTime();
        var hoursSinceAlert = (now - alertTime) / (1000 * 60 * 60);

        var name = (contact.firstName || '').trim() || 'there';
        var phone = contact.phone || '';
        var email = contact.email || '';

        // Extract deal info from custom fields for personalization
        var cf = {};
        (contact.customFields || []).forEach(function(f) {
          if (f.id) cf[f.id] = f.value;
        });
        var dealCity = cf['KuaUFXhbQB6kKvBSKfoI'] || '';
        var dealAddress = cf['TerjqctukTW67rB21ugC'] || dealCity || 'the deal';
        var dealType = cf['0thrOdoETTLlFA45oN8U'] || '';

        try {
          // DAY 0: 4-12 hours after initial alert
          if (hoursSinceAlert >= 4 && hoursSinceAlert < 24 && tags.indexOf(d0Tag) === -1) {
            // SMS 1
            if (phone) {
              await ghlRequest(apiKey, 'POST', '/conversations/messages', {
                type: 'SMS', contactId: contact.id,
                message: 'Quick check on ' + (dealCity || dealAddress) + ' I sent you:\n1 = very interested\n2 = maybe / want to talk\n3 = pass\nReply with just the number.'
              });
            }
            // Email 1
            if (email) {
              await ghlRequest(apiKey, 'POST', '/conversations/messages', {
                type: 'Email', contactId: contact.id,
                subject: '5-second check: ' + (dealAddress || 'the deal') + '?',
                html: '<div style="font-family:Arial,sans-serif;max-width:500px">'
                  + '<p>Hey ' + name + ',</p>'
                  + '<p>Sent you <strong>' + dealAddress + '</strong>. Can you hit reply with one of these?</p>'
                  + '<p><strong>IN</strong> = I want to explore this one<br>'
                  + '<strong>MAYBE</strong> = not sure, want to talk<br>'
                  + '<strong>PASS</strong> = not my box, keep sending others</p>'
                  + '<p>This helps me prioritize who gets first crack on this and similar deals.</p>'
                  + '<p>— Brooke, Terms For Sale</p></div>',
                emailFrom: 'Brooke Froehlich <brooke@mydealpros.com>'
              });
            }
            await ghlRequest(apiKey, 'POST', '/contacts/' + contact.id + '/tags', { tags: [d0Tag] });
            stats.d0++;
            console.log('[deal-follow-up] D0 sent to ' + name + ' for ' + dealId);
          }

          // DAY 1: 24-48 hours after initial alert
          else if (hoursSinceAlert >= 24 && hoursSinceAlert < 48 && tags.indexOf(d1Tag) === -1 && tags.indexOf(d0Tag) > -1) {
            // SMS 2 for non-responders
            if (phone) {
              await ghlRequest(apiKey, 'POST', '/conversations/messages', {
                type: 'SMS', contactId: contact.id,
                message: 'Still buying in ' + (dealCity || 'the area') + (dealType ? ' at ' + dealType : '') + '? If yes, want me to prioritize deals like ' + (dealAddress || 'this one') + ' for you, or pause you for now?'
              });
            }
            await ghlRequest(apiKey, 'POST', '/contacts/' + contact.id + '/tags', { tags: [d1Tag] });
            stats.d1++;
            console.log('[deal-follow-up] D1 sent to ' + name + ' for ' + dealId);
          }

          // DAY 2: 48-72 hours after initial alert
          else if (hoursSinceAlert >= 48 && hoursSinceAlert < 96 && tags.indexOf(d2Tag) === -1 && tags.indexOf(d1Tag) > -1) {
            // Email 2
            if (email) {
              await ghlRequest(apiKey, 'POST', '/conversations/messages', {
                type: 'Email', contactId: contact.id,
                subject: dealAddress + ' — choosing buyer / update your buy box',
                html: '<div style="font-family:Arial,sans-serif;max-width:500px">'
                  + '<p>Wrapping interest on <strong>' + dealAddress + '</strong>.</p>'
                  + '<p>If you want main or backup spot, reply <strong>IN</strong> today.</p>'
                  + '<p>If not, hit reply with your exact buy box (price, city, strategy) so I only send you slam-dunks.</p>'
                  + '<p>If I don\'t hear back, I\'ll assume you\'re paused for now.</p>'
                  + '<p>— Brooke, Terms For Sale</p></div>',
                emailFrom: 'Brooke Froehlich <brooke@mydealpros.com>'
              });
            }
            // SMS 3
            if (phone) {
              await ghlRequest(apiKey, 'POST', '/conversations/messages', {
                type: 'SMS', contactId: contact.id,
                message: 'Last ping on ' + (dealAddress || 'the deal') + '.\nWant me to:\nA) Keep sending you stuff like this\nB) Tighten to ' + (dealCity || 'your market') + ' only\nC) Pause alerts for now\nReply A/B/C.'
              });
            }
            await ghlRequest(apiKey, 'POST', '/contacts/' + contact.id + '/tags', { tags: [d2Tag] });
            stats.d2++;
            console.log('[deal-follow-up] D2 sent to ' + name + ' for ' + dealId);
          }

          else {
            stats.skipped++;
          }
        } catch (err) {
          console.error('[deal-follow-up] Error on ' + contact.id + '/' + dealId + ':', err.message);
        }
      }
    }

    console.log('[deal-follow-up] Done. D0=' + stats.d0 + ' D1=' + stats.d1 + ' D2=' + stats.d2 + ' skipped=' + stats.skipped);
    return { statusCode: 200 };

  } catch (err) {
    console.error('[deal-follow-up] Fatal:', err.message);
    return { statusCode: 500 };
  }
};

// Find contacts with any alerted-* tag
async function findAlertedContacts(apiKey, locationId) {
  var tagged = [];
  var page = 1;
  var hasMore = true;

  while (hasMore) {
    var res = await fetch(GHL_BASE + '/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      },
      body: JSON.stringify({
        locationId: locationId,
        page: page,
        pageLimit: 100,
        filters: [{
          group: 'AND',
          filters: [{
            field: 'tags',
            operator: 'contains',
            value: ['new-deal-alert']
          }]
        }]
      })
    });

    if (!res.ok) break;
    var data = await res.json();
    var batch = data.contacts || data.data || [];
    tagged = tagged.concat(batch);

    var meta = data.meta || {};
    if (tagged.length >= (meta.total || batch.length) || !batch.length) hasMore = false;
    else page++;
  }

  return tagged;
}
