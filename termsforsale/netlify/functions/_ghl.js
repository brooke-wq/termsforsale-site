// Shared GHL helper — native fetch (Node 18+), no npm packages
// Prefix _ means Netlify will NOT deploy this as a function (it's a private module)
//
// Exports: cfMap, findByTag, getContact, postNote, addTags, removeTags,
//          swapTags, updateContact, updateCustomFields, sendSMS, upsertContact

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function ghlHeaders(apiKey) {
  return {
    'Authorization': 'Bearer ' + apiKey,
    'Version': GHL_VERSION,
    'Content-Type': 'application/json'
  };
}

async function ghlRequest(apiKey, method, path, body) {
  var url = GHL_BASE + path;
  var opts = { method: method, headers: ghlHeaders(apiKey) };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(url, opts);
  var text = await res.text();
  var parsed;
  try { parsed = JSON.parse(text); } catch(e) { parsed = text; }
  if (res.status >= 400) {
    console.error('GHL ' + method + ' ' + path + ' -> ' + res.status, typeof parsed === 'object' ? JSON.stringify(parsed) : parsed);
  }
  return { status: res.status, body: parsed };
}

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
async function sendSMS(apiKey, locationId, toPhone, message) {
  // Normalize phone
  var phone = toPhone.replace(/\s+/g, '');

  // Look up contact by phone to get contactId for conversation
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
    message: message
  });
}

async function upsertContact(apiKey, locationId, data) {
  return ghlRequest(apiKey, 'POST', '/contacts/upsert',
    Object.assign({ locationId: locationId }, data));
}

module.exports = {
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
  upsertContact
};
