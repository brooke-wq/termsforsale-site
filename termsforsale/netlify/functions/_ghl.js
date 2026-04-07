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

// Move an opportunity to a different stage in the same pipeline.
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
module.exports = { upsertContact, createOpportunity, sendSmsToBrooke, sendEmailToContact, isTest, getStageIdByName, advanceOpportunityStage,
  findContactByEmail, findOpportunityByContactAndDealCode, sendTokenizedDataRoomEmail, };
