/**
 * GHL Booking Notification — POST /.netlify/functions/booking-notify
 *
 * Webhook endpoint for GHL calendar "PoyDG0tNCK8wb9oi6zZ4" booking events.
 * When a buyer books a call, this sends a notification to Brooke via SMS
 * and posts a note on the contact's GHL record.
 *
 * GHL webhook sends: { contact_id, calendar_id, start_time, ... }
 */

const { getContact, postNote, addTags, sendSMS } = require('./_ghl');

const CALENDAR_ID = 'PoyDG0tNCK8wb9oi6zZ4';
const BROOKE_CONTACT_ID = '1HMBtAv9EuTlJa5EekAL';
const BROOKE_PHONE = process.env.BROOKE_PHONE || '+15167120113';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey) return respond(500, { error: 'Server config error' });

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return respond(400, { error: 'Invalid JSON' }); }

  // GHL webhook payload varies — extract what we can
  const contactId = body.contact_id || body.contactId || (body.contact && body.contact.id);
  const calendarId = body.calendar_id || body.calendarId || CALENDAR_ID;
  const startTime = body.start_time || body.startTime || body.selectedTimeslot || '';
  const status = body.status || body.appointment_status || 'booked';

  console.log('[booking-notify] event:', JSON.stringify({ contactId, calendarId, startTime, status }));

  if (!contactId) {
    console.warn('[booking-notify] No contactId in payload');
    return respond(200, { ok: true, skipped: 'no contactId' });
  }

  try {
    // Get contact details
    const contactRes = await getContact(apiKey, contactId);
    const contact = contactRes.body && contactRes.body.contact;
    const name = contact ? (contact.firstName || '') + ' ' + (contact.lastName || '') : 'Unknown';
    const phone = contact ? (contact.phone || '') : '';
    const email = contact ? (contact.email || '') : '';

    // Format time
    let timeStr = startTime;
    try {
      if (startTime) {
        const d = new Date(startTime);
        timeStr = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix' });
      }
    } catch (e) { /* keep raw */ }

    // Post note on contact
    await postNote(apiKey, contactId,
      '📅 BOOKING ' + status.toUpperCase() + '\n' +
      '─────────────────\n' +
      'Name: ' + name.trim() + '\n' +
      'Phone: ' + phone + '\n' +
      'Email: ' + email + '\n' +
      'Time: ' + timeStr + '\n' +
      'Calendar: ' + calendarId + '\n' +
      '─────────────────\n' +
      'Source: GHL Calendar Webhook'
    );

    // Tag the contact
    await addTags(apiKey, contactId, ['Booked Call', 'Hot Lead']);

    // Notify Brooke via SMS
    var sms = '📅 New booking: ' + name.trim() + (phone ? ' (' + phone + ')' : '') + ' — ' + timeStr;
    if (sms.length > 160) sms = sms.slice(0, 157) + '...';
    try {
      await sendSMS(apiKey, locationId, BROOKE_PHONE, sms);
      console.log('[booking-notify] SMS sent to Brooke: ' + sms);
    } catch (e) {
      console.warn('[booking-notify] Brooke SMS failed:', e.message);
    }

    console.log('[booking-notify] ' + name.trim() + ' booked for ' + timeStr + ' | phone=' + phone);

    return respond(200, {
      ok: true,
      contact: name.trim(),
      time: timeStr,
      status: status
    });

  } catch (err) {
    console.error('[booking-notify] error:', err.message);
    return respond(500, { error: err.message });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
