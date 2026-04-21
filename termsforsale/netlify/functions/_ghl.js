// Shared GHL helper — native fetch (Node 18+), no npm packages
// Prefix _ means Netlify will NOT deploy this as a function (it's a private module)
//
// Legacy exports (used by ~20 functions):
//   cfMap, CF_IDS, findByTag, searchContacts, getContact, postNote,
//   addTags, removeTags, swapTags, updateContact, updateCustomFields,
//   sendSMS, sendEmail, upsertContact (3-arg: apiKey, locationId, data)
//
// Commercial lane exports (added April 7 for the commercial/multifamily lane):
//   ghlFetch, createOpportunity, sendSmsToBrooke, sendEmailToContact,
//   isTest, getStageIdByName, advanceOpportunityStage, findContactByEmail,
//   findOpportunityByContactAndDealCode, sendTokenizedDataRoomEmail
//
// upsertContact is polymorphic — it detects whether it was called with the
// old 3-arg style (apiKey, locationId, data) or the new 1-arg destructured
// style ({email, phone, ...}) and routes accordingly.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

const isTest = () => String(process.env.TEST_MODE || '').toLowerCase() === 'true';

// ─── Campaign sender identity (REQUIRED for all outbound) ───────
// Per company policy, EVERY outbound SMS/email — campaigns and
// transactional alike — must originate from the company phone +
// inbox so replies route correctly and recipients see a consistent
// brand. Override via env vars only if you know what you're doing.
const CAMPAIGN_FROM_PHONE = process.env.CAMPAIGN_FROM_PHONE || '+14806373117';
const CAMPAIGN_FROM_EMAIL = process.env.CAMPAIGN_FROM_EMAIL || 'Terms For Sale <info@termsforsale.com>';

// Required opt-in tag every buyer must have BEFORE we send any
// campaign SMS/email. Set on the contact when they actively opt in
// (signup, buy box, VIP) — never inferred. Case-insensitive match.
const OPT_IN_TAG = 'opt in';

// Returns true if the contact has the "opt in" tag (case-insensitive,
// trimmed). Accepts either a contact object or a raw tags array.
// Use this BEFORE sending any campaign SMS/email to a buyer.
function hasOptInTag(contactOrTags) {
  var tags = Array.isArray(contactOrTags)
    ? contactOrTags
    : (contactOrTags && contactOrTags.tags) || [];
  return tags.some(function (t) {
    return String(t || '').trim().toLowerCase() === OPT_IN_TAG;
  });
}

// ─── Low-level HTTP helpers ─────────────────────────────────────

function ghlHeaders(apiKey) {
  return {
    'Authorization': 'Bearer ' + apiKey,
    'Version': API_VERSION,
    'Content-Type': 'application/json'
  };
}

// Legacy request helper — returns { status, body }, does NOT throw on 4xx/5xx.
async function ghlRequest(apiKey, method, path, body) {
  var url = GHL_BASE + path;
  var opts = { method: method, headers: ghlHeaders(apiKey) };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(url, opts);
  var text = await res.text();
  var parsed;
  try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
  if (res.status >= 400) {
    console.error('GHL ' + method + ' ' + path + ' -> ' + res.status, typeof parsed === 'object' ? JSON.stringify(parsed) : parsed);
  }
  return { status: res.status, body: parsed };
}

// New-style request helper — throws on non-2xx, used by commercial lane.
// Honors TEST_MODE env var (logs payload instead of making the call).
async function ghlFetch(path, opts = {}) {
  const url = `${GHL_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: API_VERSION,
    Accept: 'application/json',
    ...(opts.headers || {}),
  };
  if (isTest()) {
    console.log('[TEST_MODE] GHL', opts.method || 'GET', path, opts.body || '');
    return { ok: true, test: true, path };
  }
  const r = await fetch(url, { ...opts, headers });
  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`GHL ${r.status}: ${json.message || text}`);
  return json;
}

// ─── Field maps ──────────────────────────────────────────────────

// Flatten a contact's customFields array into { key: value } object
function cfMap(contact) {
  var fields = contact.customFields || contact.customField || [];
  var map = {};
  if (Array.isArray(fields)) {
    fields.forEach(function(f) {
      if (f.id)  map[f.id] = f.value;
      if (f.key) map[f.key] = f.field_value || f.value;
    });
  }
  return map;
}

// Known custom field IDs (Terms For Sale location)
const CF_IDS = {
  // Buy box fields
  TARGET_STATES:       'aewzY7iEvZh12JhMVi7E',
  TARGET_CITIES:       'DbY7dHIXk8YowpaWrxYj',
  DEAL_STRUCTURES:     '0L0ycmmsEjy6OPDL0rgq',
  PROPERTY_TYPE:       'HGC6xWLpSqoAQPZr0uwY',
  MAX_PRICE:           'BcxuopmSK4wA3Z3NyanD',
  MAX_ENTRY:           'SZmNHA3BQva2AZg00ZNP',
  MIN_ARV:             'KKGEfgdaqu98yrZYkmoO',
  MIN_BEDS:            'RRuCraVtRUlEMvdFXngv',
  EXIT_STRATEGIES:     '98i8EKc3OWYSqS4Qb1nP',
  TARGET_MARKETS:      'XjXqGv6Y82iTP659pO4t',
  BUYER_TYPE:          '95PgdlIYfXYcMymnjsIv',
  CONTACT_ROLE:        'agG4HMPB5wzsZXiRxfmR',
  // Deal alert fields (used by notify-buyers)
  ALERT_FULL_ADDRESS:  'TerjqctukTW67rB21ugC',
  ALERT_CITY:          'KuaUFXhbQB6kKvBSKfoI',
  ALERT_STATE:         'ltmVcWUpbwZ0S3dBid3U',
  ALERT_ZIP:           'UqJl4Dq6T8wfNb70EMrL',
  ALERT_DEAL_TYPE:     '0thrOdoETTLlFA45oN8U',
  ALERT_DEAL_URL:      '5eEVPcp8nERlR6GpjZUn',
  ALERT_DEAL_SUMMARY:  'YjoPoDPv7Joo1izePpDx',
  ALERT_ASKING_PRICE:  'iur6TZsfKotwO3gZb8yk',
  ALERT_ENTRY_FEE:     'DH4Ekmyw2dvzrE74JSzs',
  ALERT_PROPERTY_TYPE: 'DJFMav5mPvWBzsPdhAqy',
  ALERT_BEDS:          '2iVO7pRpi0f0ABb6nYka',
  ALERT_BATHS:         'rkzCcjHJMFJP3GcwnNx6',
  ALERT_YEAR_BUILT:    'nNMHvkPbjGYRbOB1v7vQ',
  ALERT_SQFT:          'MgNeVZgMdTcdatcTTHue',
  ALERT_HIGHLIGHTS:    'eke6ZGnex77y5aUCNgly',
  ALERT_COVER_PHOTO:   'FXp9oPT4T4xqA1HIJuSC'
};

// ─── Legacy contact operations ──────────────────────────────────

// Search contacts by tag (returns contacts array)
async function findByTag(apiKey, locationId, tag) {
  return ghlRequest(apiKey, 'GET',
    '/contacts/?locationId=' + encodeURIComponent(locationId) +
    '&query=' + encodeURIComponent(tag) + '&limit=100');
}

// Search contacts by any query string (name, email, phone)
async function searchContacts(apiKey, locationId, query, limit) {
  return ghlRequest(apiKey, 'GET',
    '/contacts/?locationId=' + encodeURIComponent(locationId) +
    '&query=' + encodeURIComponent(query) + '&limit=' + (limit || 10));
}

async function getContact(apiKey, contactId) {
  return ghlRequest(apiKey, 'GET', '/contacts/' + contactId);
}

async function postNote(apiKey, contactId, body) {
  return ghlRequest(apiKey, 'POST', '/contacts/' + contactId + '/notes', { body: body });
}

async function addTags(apiKey, contactId, tags) {
  return ghlRequest(apiKey, 'POST', '/contacts/' + contactId + '/tags', { tags: tags });
}

async function removeTags(apiKey, contactId, tags) {
  return ghlRequest(apiKey, 'DELETE', '/contacts/' + contactId + '/tags', { tags: tags });
}

// Remove tagsToRemove then add tagsToAdd in sequence
async function swapTags(apiKey, contactId, tagsToRemove, tagsToAdd) {
  if (tagsToRemove && tagsToRemove.length) {
    await removeTags(apiKey, contactId, tagsToRemove);
  }
  if (tagsToAdd && tagsToAdd.length) {
    return addTags(apiKey, contactId, tagsToAdd);
  }
  return { status: 200, body: {} };
}

async function updateContact(apiKey, contactId, data) {
  return ghlRequest(apiKey, 'PUT', '/contacts/' + contactId, data);
}

// fields: [{id: 'fieldId', value: 'value'}, ...]
async function updateCustomFields(apiKey, contactId, fields) {
  return ghlRequest(apiKey, 'PUT', '/contacts/' + contactId, { customFields: fields });
}

// Send SMS to a phone number via GHL conversations API.
// Looks up the contact by phone first; falls back to sending by phone number directly.
// Always sets fromNumber to CAMPAIGN_FROM_PHONE so replies route to the company line.
async function sendSMS(apiKey, locationId, toPhone, message) {
  var phone = (toPhone || '').replace(/\s+/g, '');

  var searchRes = await ghlRequest(apiKey, 'GET',
    '/contacts/?locationId=' + encodeURIComponent(locationId) +
    '&query=' + encodeURIComponent(phone) + '&limit=5');

  var contacts = (searchRes.body && searchRes.body.contacts) || [];
  var contactId = contacts.length ? contacts[0].id : null;

  if (!contactId) {
    console.warn('sendSMS: no GHL contact found for ' + phone + ', cannot send SMS');
    return { status: 404, body: { error: 'Contact not found for phone ' + phone } };
  }

  return ghlRequest(apiKey, 'POST', '/conversations/messages', {
    type: 'SMS',
    contactId: contactId,
    message: message,
    fromNumber: CAMPAIGN_FROM_PHONE
  });
}

// Send Email via GHL conversations API.
// Always sets emailFrom to CAMPAIGN_FROM_EMAIL so replies route to the company inbox.
async function sendEmail(apiKey, contactId, subject, htmlBody) {
  return ghlRequest(apiKey, 'POST', '/conversations/messages', {
    type: 'Email',
    contactId: contactId,
    subject: subject,
    html: htmlBody,
    emailFrom: CAMPAIGN_FROM_EMAIL
  });
}

// Polymorphic upsertContact:
//   Legacy style:  upsertContact(apiKey, locationId, data)  → returns { status, body }
//   Commercial:    upsertContact({email, phone, name, tags, customFields, source}) → returns contactId string
//
// We detect by inspecting the first argument: if it's a string, it's the
// legacy 3-arg call; if it's an object, it's the commercial-lane style.
async function upsertContact() {
  var a0 = arguments[0];
  // Legacy: upsertContact(apiKey, locationId, data)
  if (typeof a0 === 'string') {
    var apiKey = a0;
    var locationId = arguments[1];
    var data = arguments[2] || {};
    return ghlRequest(apiKey, 'POST', '/contacts/upsert',
      Object.assign({ locationId: locationId }, data));
  }
  // Commercial: upsertContact({email, phone, name, ...})
  var opts = a0 || {};
  var email = opts.email;
  var phone = opts.phone;
  var firstName = opts.firstName;
  var lastName = opts.lastName;
  var name = opts.name;
  var tags = opts.tags || [];
  var customFields = opts.customFields || {};
  var source = opts.source || 'Commercial Lane';
  var locId = process.env.GHL_LOCATION_ID;
  var parts = (name || '').trim().split(' ');
  var fn = parts[0] || '';
  var ln = parts.slice(1).join(' ');
  var body = {
    locationId: locId,
    email: email,
    phone: phone,
    firstName: firstName || fn || '',
    lastName: lastName || ln || '',
    tags: tags,
    source: source,
    customFields: Object.keys(customFields)
      .filter(function(k) { var v = customFields[k]; return v !== undefined && v !== null && v !== ''; })
      .map(function(k) {
        var v = customFields[k];
        return { key: k, field_value: Array.isArray(v) ? v.join(', ') : String(v) };
      })
  };
  var res = await ghlFetch('/contacts/upsert', { method: 'POST', body: JSON.stringify(body) });
  return (res && res.contact && res.contact.id) || (res && res.id) || (isTest() ? 'test-contact-id' : null);
}

// ─── Commercial lane helpers ────────────────────────────────────

async function createOpportunity({ contactId, pipelineId, stageId, name, monetaryValue = 0, customFields = {} }) {
  const body = {
    locationId: process.env.GHL_LOCATION_ID,
    pipelineId,
    pipelineStageId: stageId,
    name,
    status: 'open',
    contactId,
    monetaryValue,
    customFields: Object.entries(customFields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([key, value]) => ({ key, field_value: String(value) })),
  };
  const res = await ghlFetch('/opportunities/', { method: 'POST', body: JSON.stringify(body) });
  return res?.opportunity?.id || res?.id || (isTest() ? 'test-opp-id' : null);
}

async function sendSmsToBrooke(message) {
  const to = process.env.BROOKE_SMS_PHONE;
  if (!to) { console.warn('BROOKE_SMS_PHONE not set'); return; }
  if (isTest()) { console.log('[TEST_MODE] SMS → Brooke:', message); return; }
  await ghlFetch('/conversations/messages', {
    method: 'POST',
    body: JSON.stringify({
      type: 'SMS',
      locationId: process.env.GHL_LOCATION_ID,
      contactId: process.env.BROOKE_CONTACT_ID,
      toNumber: to,
      message,
      fromNumber: CAMPAIGN_FROM_PHONE,
    }),
  });
}

async function sendEmailToContact({ contactId, subject, html }) {
  if (isTest()) { console.log('[TEST_MODE] EMAIL →', contactId, subject); return; }
  await ghlFetch('/conversations/messages', {
    method: 'POST',
    body: JSON.stringify({
      type: 'Email',
      locationId: process.env.GHL_LOCATION_ID,
      contactId,
      subject,
      html,
      emailFrom: CAMPAIGN_FROM_EMAIL,
    }),
  });
}

// --- Stage ID lookup by name (avoids hardcoding stage IDs in env vars) ---
// Simple in-memory cache so we only hit the API once per cold start.
const stageCache = {};
async function getStageIdByName(pipelineId, stageName) {
  const key = `${pipelineId}::${stageName}`;
  if (stageCache[key]) return stageCache[key];
  if (isTest()) return `test-stage-${stageName.replace(/\s+/g,'-').toLowerCase()}`;
  const res = await ghlFetch(`/opportunities/pipelines?locationId=${process.env.GHL_LOCATION_ID}`);
  const pipelines = res.pipelines || res.data || [];
  const p = pipelines.find(x => x.id === pipelineId);
  if (!p) throw new Error(`Pipeline ${pipelineId} not found`);
  (p.stages || []).forEach(s => {
    stageCache[`${pipelineId}::${s.name}`] = s.id;
  });
  const id = stageCache[key];
  if (!id) throw new Error(`Stage "${stageName}" not found in pipeline ${pipelineId}`);
  return id;
}

async function advanceOpportunityStage({ opportunityId, pipelineId, stageName }) {
  const stageId = await getStageIdByName(pipelineId, stageName);
  if (isTest()) {
    console.log('[TEST_MODE] GHL PUT /opportunities/' + opportunityId, { stageId, stageName });
    return { ok: true, test: true, opportunityId, stageId };
  }
  return await ghlFetch(`/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify({ pipelineId, pipelineStageId: stageId, status: 'open' }),
  });
}

async function findContactByEmail(email) {
  if (isTest()) return { id: 'test-contact-id', email };
  const res = await ghlFetch(`/contacts/search/duplicate?locationId=${process.env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`);
  return res?.contact || null;
}

async function findOpportunityByContactAndDealCode({ contactId, pipelineId, dealCode }) {
  if (isTest()) return { id: 'test-opp-id', contactId, dealCode };
  const res = await ghlFetch(`/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&pipeline_id=${pipelineId}&contact_id=${contactId}`);
  const opps = res?.opportunities || [];
  const match = opps.find(o => {
    const cf = (o.customFields || []).find(c => c.id?.includes('deal_code') || c.field_value === dealCode);
    return !!cf;
  }) || opps[0];
  return match || null;
}

async function sendTokenizedDataRoomEmail({ contactId, contactName, dealCode, tokenizedUrl, expiresAt }) {
  const subject = `Your data room access — ${dealCode}`;
  const expiryStr = new Date(expiresAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const html = `
    <p>Hi ${(contactName || '').split(' ')[0] || 'there'},</p>
    <p>Your NDA for <b>${dealCode}</b> is signed — here's the full data room.</p>
    <p style="margin:24px 0">
      <a href="${tokenizedUrl}" style="background:#f5b301;color:#111;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open the Data Room</a>
    </p>
    <p style="color:#666;font-size:13px">This link is unique to you and expires on <b>${expiryStr}</b>. Need a fresh link after that? Just click the link and request a new one — as long as your NDA is on file, you'll get instant access.</p>
    <p style="color:#666;font-size:13px">Please don't forward this link. Each link is logged and tied to your account.</p>
    <p>— Brooke<br/>Deal Pros</p>
  `;
  await sendEmailToContact({ contactId, subject, html });
}

// ─── Exports ─────────────────────────────────────────────────────

module.exports = {
  // Campaign sender identity (April 14 — info@termsforsale.com / 480-637-3117)
  CAMPAIGN_FROM_PHONE,
  CAMPAIGN_FROM_EMAIL,
  OPT_IN_TAG,
  hasOptInTag,
  // Legacy exports (restored April 9 after April 7 regression)
  cfMap,
  CF_IDS,
  findByTag,
  searchContacts,
  getContact,
  postNote,
  addTags,
  removeTags,
  swapTags,
  updateContact,
  updateCustomFields,
  sendSMS,
  sendEmail,
  upsertContact,
  // Commercial lane exports
  ghlFetch,
  createOpportunity,
  sendSmsToBrooke,
  sendEmailToContact,
  isTest,
  getStageIdByName,
  advanceOpportunityStage,
  findContactByEmail,
  findOpportunityByContactAndDealCode,
  sendTokenizedDataRoomEmail,
};
