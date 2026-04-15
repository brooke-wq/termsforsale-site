/**
 * Auth Reset — POST /.netlify/functions/auth-reset
 *
 * Two modes:
 * 1. Request reset: {email} → sends 6-digit code via email
 * 2. Confirm reset: {email, code, newPassword} → verifies code, updates password
 *
 * Reset codes stored as GHL custom field (tfs_reset_code) with expiry.
 */

const crypto = require('crypto');
const GHL_BASE = 'https://services.leadconnectorhq.com';

function hashPassword(pw) {
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return respond(500, { error: 'Server config error' });

  var body;
  try { body = JSON.parse(event.body); }
  catch (e) { return respond(400, { error: 'Invalid JSON' }); }

  var headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  var email = (body.email || '').trim().toLowerCase();
  if (!email) return respond(400, { error: 'Email is required' });

  // Find contact
  var contact = await findContact(email, locationId, headers);
  if (!contact) {
    // Don't reveal if email exists or not (security)
    return respond(200, { success: true, message: 'If that email exists, a reset code has been sent.' });
  }

  // MODE 1: Request reset code
  if (!body.code && !body.newPassword) {
    var code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit code
    var expiry = Date.now() + 15 * 60 * 1000; // 15 minutes
    var resetValue = code + ':' + expiry;

    // Store code on contact
    await ghlFetch(GHL_BASE + '/contacts/' + contact.id, 'PUT', {
      customFields: [{ key: 'tfs_reset_code', field_value: resetValue }]
    }, headers);

    // Send code via email
    await ghlFetch(GHL_BASE + '/conversations/messages', 'POST', {
      type: 'Email',
      contactId: contact.id,
      subject: 'Password Reset — Terms For Sale',
      html: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">'
        + '<div style="background:#0D1F3C;padding:20px 32px;border-radius:12px 12px 0 0">'
        + '<img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:32px">'
        + '</div>'
        + '<div style="padding:28px 32px">'
        + '<h2 style="color:#0D1F3C;margin:0 0 12px">Reset Your Password</h2>'
        + '<p style="color:#4A5568;line-height:1.6">Your reset code is:</p>'
        + '<div style="background:#F4F6F9;border-radius:8px;padding:20px;text-align:center;margin:16px 0">'
        + '<span style="font-size:32px;font-weight:900;color:#0D1F3C;letter-spacing:6px">' + code + '</span>'
        + '</div>'
        + '<p style="color:#718096;font-size:13px">This code expires in 15 minutes. If you didn\'t request this, ignore this email.</p>'
        + '</div></div>',
      emailFrom: 'Terms For Sale <info@termsforsale.com>'
    }, headers);

    // Also send via SMS if they have a phone
    if (contact.phone) {
      await ghlFetch(GHL_BASE + '/conversations/messages', 'POST', {
        type: 'SMS',
        contactId: contact.id,
        message: 'Your Terms For Sale password reset code is: ' + code + '. Expires in 15 min.'
      }, headers).catch(function() {});
    }

    console.log('[auth-reset] Code sent to ' + email);
    return respond(200, { success: true, message: 'Reset code sent to your email and phone.' });
  }

  // MODE 2: Verify code and set new password
  if (body.code && body.newPassword) {
    var newPassword = body.newPassword.trim();
    if (newPassword.length < 6) {
      return respond(400, { error: 'Password must be at least 6 characters' });
    }

    // Get stored code — search by key, id, or value format (6digits:timestamp)
    var storedReset = '';
    var resetFieldId = '';
    var cfs = contact.customFields || [];
    for (var i = 0; i < cfs.length; i++) {
      var val = cfs[i].value || '';
      if (cfs[i].key === 'tfs_reset_code' || cfs[i].id === 'tfs_reset_code'
        || /^\d{6}:\d{13}$/.test(val)) {
        storedReset = val;
        resetFieldId = cfs[i].id || 'tfs_reset_code';
        break;
      }
    }

    if (!storedReset) {
      return respond(400, { error: 'No reset code found. Please request a new one.' });
    }

    var parts = storedReset.split(':');
    var storedCode = parts[0];
    var storedExpiry = parseInt(parts[1]) || 0;

    if (String(body.code).trim() !== storedCode) {
      return respond(400, { error: 'Incorrect code. Please check and try again.' });
    }

    if (Date.now() > storedExpiry) {
      return respond(400, { error: 'Code has expired. Please request a new one.' });
    }

    // Hash new password and store
    var newHash = hashPassword(newPassword);
    await ghlFetch(GHL_BASE + '/contacts/' + contact.id, 'PUT', {
      customFields: [
        { key: 'tfs_password_hash', field_value: newHash },
        { key: 'tfs_reset_code', field_value: '' } // Clear the code
      ]
    }, headers);

    console.log('[auth-reset] Password reset for ' + email);
    return respond(200, { success: true, message: 'Password updated successfully. You can now log in.' });
  }

  return respond(400, { error: 'Invalid request' });
};

async function findContact(email, locationId, headers) {
  var url = GHL_BASE + '/contacts/search/duplicate?locationId=' + locationId + '&email=' + encodeURIComponent(email);
  var res = await ghlFetch(url, 'GET', null, headers);
  if (!res.ok) return null;
  var data = await res.json();
  var contact = data.contact || null;
  if (contact && contact.id) {
    try {
      var fullRes = await ghlFetch(GHL_BASE + '/contacts/' + contact.id, 'GET', null, headers);
      if (fullRes.ok) { var fullData = await fullRes.json(); contact = fullData.contact || contact; }
    } catch (e) {}
  }
  return contact;
}

async function ghlFetch(url, method, body, headers) {
  var opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
}

function respond(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', ...corsHeaders() }, body: JSON.stringify(body) };
}
