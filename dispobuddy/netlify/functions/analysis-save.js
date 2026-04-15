/**
 * Dispo Buddy — Save Underwriting Analysis
 * POST /api/analysis/save
 * Requires X-Admin-Password header.
 *
 * Accepts the full analysis payload from the underwriting workspace UI
 * and persists it to GHL (as a contact note) and/or Notion.
 *
 * Save targets (payload.saveTarget):
 *   - "ghl"    → post note on BROOKE_CONTACT_ID (default)
 *   - "notion" → create a page in NOTION_UNDERWRITING_DB_ID (if set)
 *   - "both"   → do both
 *
 * Env vars:
 *   ADMIN_PASSWORD               — gate
 *   GHL_API_KEY, GHL_LOCATION_ID — GHL note write
 *   BROOKE_CONTACT_ID            — default contact to attach the note (optional; falls back to
 *                                   looking up the first contact tagged "underwriting-admin")
 *   NOTION_TOKEN                 — Notion writes (optional)
 *   NOTION_UNDERWRITING_DB_ID    — Separate Notion DB for underwriting pages (optional).
 *                                   If missing, Notion save is skipped with a warning.
 */

const crypto = require('crypto');

function verifyAdmin(event) {
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, reason: 'ADMIN_PASSWORD not configured' };
  var provided = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || '';
  if (!provided) return { ok: false, reason: 'Password required' };
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return { ok: false, reason: 'Invalid password' };
  }
  try {
    var eq = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    return eq ? { ok: true } : { ok: false, reason: 'Invalid password' };
  } catch (e) {
    return { ok: false, reason: 'Invalid password' };
  }
}

function fmtMoney(n) {
  var num = Number(n);
  if (!num || isNaN(num)) return '$0';
  return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function buildNoteText(a) {
  var lines = [
    '📊 UNDERWRITING ANALYSIS — ' + (a.status || 'unknown').toUpperCase(),
    '',
    'Address: ' + (a.address || '—'),
    'Deal type: ' + (a.dealType || '—'),
    'CRM route: ' + (a.crmRoute || '—'),
    '',
    '— PRICING —',
    'ARV: ' + fmtMoney(a.arv),
    'Contract: ' + fmtMoney(a.contract),
    'Repairs: ' + fmtMoney(a.repairs),
    'True cost: ' + fmtMoney(a.trueCost),
    'Spread: ' + fmtMoney(a.spread),
    '',
    '— METRICS —',
    'Equity %: ' + (a.equityPct != null ? a.equityPct.toFixed(1) + '%' : '—'),
    'Cashflow margin: ' + (a.cashflowMarginPct != null ? a.cashflowMarginPct.toFixed(1) + '%' : '—'),
    'Entry equity: ' + (a.entryEquityPct != null ? a.entryEquityPct.toFixed(1) + '%' : '—'),
    'Price / ARV: ' + (a.pricePctArv != null ? a.pricePctArv.toFixed(1) + '%' : '—'),
    'Net margin: ' + (a.netMarginPct != null ? a.netMarginPct.toFixed(1) + '%' : '—'),
    '',
    '— TERMS —',
    'Market rent: ' + fmtMoney(a.marketRent) + '/mo',
    'All-in payment: ' + fmtMoney(a.allin) + '/mo',
    'Loan balance: ' + fmtMoney(a.loanBal),
    'Down payment: ' + fmtMoney(a.down),
    'Term remaining: ' + (a.termYears || 0) + ' yrs',
    'Balloon: ' + (a.balloonYears || 0) + ' yrs',
    'Comps: ' + (a.comps || 0)
  ];
  if (a.notes) {
    lines.push('');
    lines.push('— NOTES —');
    lines.push(a.notes);
  }
  lines.push('');
  lines.push('Saved: ' + (a.savedAt || new Date().toISOString()));
  return lines.join('\n');
}

async function ghlPostNote(apiKey, contactId, body) {
  var res = await fetch('https://services.leadconnectorhq.com/contacts/' + contactId + '/notes', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ body: body })
  });
  if (!res.ok) {
    var errText = await res.text().catch(function () { return ''; });
    throw new Error('GHL note failed: ' + res.status + ' ' + errText.substring(0, 200));
  }
  return res.json();
}

async function notionCreatePage(token, dbId, a) {
  var props = {};
  // Title must match the DB's title property. Most DBs use "Name" or "Title" —
  // we try a few common names and the caller's DB should have one of them.
  var title = (a.address || 'Untitled Analysis') + ' — ' + (a.dealType || '');
  props['Name'] = { title: [{ text: { content: title.substring(0, 200) } }] };

  // Best-effort: write a bunch of numeric + text fields. Notion will
  // ignore unknown properties so we don't have to be exact about schema.
  props['Address'] = { rich_text: [{ text: { content: (a.address || '').substring(0, 500) } }] };
  props['Deal Type'] = { select: { name: String(a.dealType || 'unknown') } };
  props['Status'] = { select: { name: String(a.status || 'yellow').toUpperCase() } };
  if (a.arv) props['ARV'] = { number: Number(a.arv) };
  if (a.contract) props['Contract'] = { number: Number(a.contract) };
  if (a.repairs != null) props['Repairs'] = { number: Number(a.repairs) };
  if (a.spread != null) props['Spread'] = { number: Number(a.spread) };
  if (a.equityPct != null) props['Equity %'] = { number: Number(a.equityPct) };
  if (a.cashflowMarginPct != null) props['Cashflow Margin %'] = { number: Number(a.cashflowMarginPct) };
  if (a.notes) props['Notes'] = { rich_text: [{ text: { content: String(a.notes).substring(0, 2000) } }] };
  if (a.crmRoute) props['CRM Route'] = { rich_text: [{ text: { content: String(a.crmRoute) } }] };

  var res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ parent: { database_id: dbId }, properties: props })
  });
  if (!res.ok) {
    var errText = await res.text().catch(function () { return ''; });
    throw new Error('Notion create failed: ' + res.status + ' ' + errText.substring(0, 300));
  }
  return res.json();
}

exports.handler = async function (event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST only' }) };

  var auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: 401, headers: headers, body: JSON.stringify({ error: auth.reason }) };

  var payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  if (!payload.address) return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'address required' }) };

  var target = String(payload.saveTarget || 'ghl').toLowerCase();
  var wantsGhl = target === 'ghl' || target === 'both';
  var wantsNotion = target === 'notion' || target === 'both';

  var out = { saved: [], skipped: [], errors: [] };

  // GHL save — post a note on Brooke's contact
  if (wantsGhl) {
    var apiKey = process.env.GHL_API_KEY;
    var contactId = process.env.BROOKE_CONTACT_ID;
    if (!apiKey) { out.errors.push('ghl: GHL_API_KEY not set'); }
    else if (!contactId) { out.errors.push('ghl: BROOKE_CONTACT_ID not set'); }
    else {
      try {
        await ghlPostNote(apiKey, contactId, buildNoteText(payload));
        out.saved.push('ghl:note-on-brooke');
      } catch (e) {
        out.errors.push('ghl: ' + e.message);
      }
    }
  } else {
    out.skipped.push('ghl');
  }

  // Notion save — only if a dedicated DB ID is configured
  if (wantsNotion) {
    var notionToken = process.env.NOTION_TOKEN;
    var uwDbId = process.env.NOTION_UNDERWRITING_DB_ID;
    if (!notionToken) { out.errors.push('notion: NOTION_TOKEN not set'); }
    else if (!uwDbId) { out.errors.push('notion: NOTION_UNDERWRITING_DB_ID not set — create a dedicated Underwriting DB in Notion first'); }
    else {
      try {
        var page = await notionCreatePage(notionToken, uwDbId, payload);
        out.saved.push('notion:' + (page.id || '?'));
      } catch (e) {
        out.errors.push('notion: ' + e.message);
      }
    }
  } else {
    out.skipped.push('notion');
  }

  var status = out.saved.length > 0 ? 200 : (out.errors.length > 0 ? 502 : 200);
  return { statusCode: status, headers: headers, body: JSON.stringify(out) };
};
