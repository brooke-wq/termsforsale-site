// Shared GHL helper for commercial lane functions.
// Honors TEST_MODE env var — when "true", logs payloads instead of making live calls.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

const isTest = () => String(process.env.TEST_MODE || '').toLowerCase() === 'true';

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

// Upsert contact by email, add tags, set custom fields.
async function upsertContact({ email, phone, firstName, lastName, name, tags = [], customFields = {}, source = 'Commercial Lane' }) {
  const locationId = process.env.GHL_LOCATION_ID;
  const [fn, ...rest] = (name || '').trim().split(' ');
  const body = {
    locationId,
    email,
    phone,
    firstName: firstName || fn || '',
    lastName: lastName || rest.join(' ') || '',
    tags,
    source,
    customFields: Object.entries(customFields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([key, value]) => ({ key, field_value: Array.isArray(value) ? value.join(', ') : String(value) })),
  };
  const res = await ghlFetch('/contacts/upsert', { method: 'POST', body: JSON.stringify(body) });
  return res?.contact?.id || res?.id || (isTest() ? 'test-contact-id' : null);
}

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
      contactId: process.env.BROOKE_CONTACT_ID, // Brooke's own contact record
      message,
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
  // Cache every stage in this pipeline for future calls
  (p.stages || []).forEach(s => {
    stageCache[`${pipelineId}::${s.name}`] = s.id;
  });
  const id = stageCache[key];
  if (!id) throw new Error(`Stage "${stageName}" not found in pipeline ${pipelineId}`);
  return id;
}

module.exports = { upsertContact, createOpportunity, sendSmsToBrooke, sendEmailToContact, isTest, getStageIdByName };
