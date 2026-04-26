/**
 * Pitch Deck Generator — POST /.netlify/functions/generate-pitch-deck
 * Auth: X-Admin-Password header.  Body: { pageId: "<notion-page-uuid>" }
 * Returns: { ok, dealId, address, htmlFileId, htmlWebViewLink, pdfFileId, pdfWebViewLink, tokensReplaced, tokensFilled, unreplacedTokens }
 */
const crypto = require('crypto');

const NOTION_BASE = 'https://api.notion.com/v1';
const RENDER_DECK_URL = (process.env.RENDER_SERVICE_URL || 'http://64.23.204.220:3001/render').replace(/\/render$/, '/render-deck');
const RENDER_TOKEN = process.env.RENDER_SERVICE_TOKEN;
const EMDASH = '—';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function verifyAdmin(event) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, reason: 'ADMIN_PASSWORD not configured' };
  const headers = event.headers || {};
  const provided = headers['x-admin-password'] || headers['X-Admin-Password'] || '';
  if (!provided) return { ok: false, reason: 'Password required' };
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return { ok: false, reason: 'Invalid password' };
  }
  try {
    const eq = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    return eq ? { ok: true } : { ok: false, reason: 'Invalid password' };
  } catch (e) {
    return { ok: false, reason: 'Invalid password' };
  }
}

function prop(page, name) {
  const p = (page.properties || {})[name];
  if (!p) return null;
  switch (p.type) {
    case 'rich_text':    return (p.rich_text || []).map(r => r.plain_text).join('') || null;
    case 'title':        return (p.title || []).map(r => r.plain_text).join('') || null;
    case 'number':       return p.number != null ? p.number : null;
    case 'select':       return p.select ? p.select.name : null;
    case 'multi_select': return p.multi_select && p.multi_select.length ? p.multi_select.map(s => s.name).join(', ') : null;
    case 'status':       return p.status ? p.status.name : null;
    case 'date':         return p.date ? p.date.start : null;
    case 'url':          return p.url || null;
    case 'checkbox':     return p.checkbox;
    default:             return null;
  }
}

function fmtMoney(n) { if (n == null || n === '' || isNaN(Number(n))) return EMDASH; return '$' + Math.round(Number(n)).toLocaleString(); }
function fmtMoneyShort(n) { if (n == null || n === '' || isNaN(Number(n))) return EMDASH; const num = Number(n); if (num >= 1000) return '$' + Math.round(num / 1000) + 'K'; return '$' + Math.round(num).toLocaleString(); }
function fmtPct(n, decimals) { if (n == null || n === '' || isNaN(Number(n))) return EMDASH; return Number(n).toFixed(decimals != null ? decimals : 2) + '%'; }
function fmtNumber(n) { if (n == null || n === '' || isNaN(Number(n))) return EMDASH; return Number(n).toLocaleString(); }
function fmtDate(iso) { if (!iso) return EMDASH; try { const d = new Date(iso); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); } catch (e) { return EMDASH; } }
function emOrStr(s) { return (s != null && s !== '') ? String(s) : EMDASH; }
function parseMoneyText(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  const cleaned = String(s).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function buildTokenMap(page, pageId) {
  const streetAddress = prop(page, 'Street Address') || '';
  const city          = prop(page, 'City') || '';
  const state         = prop(page, 'State') || '';
  const zip           = prop(page, 'ZIP') || '';
  const dealId        = prop(page, 'Deal ID') || ('TFS-' + pageId.replace(/-/g, '').slice(0, 8).toUpperCase());
  const dealType      = prop(page, 'Deal Type') || 'Cash';
  const askingPrice   = prop(page, 'Asking Price');
  const arv           = prop(page, 'ARV');
  const beds          = prop(page, 'Beds');
  const baths         = prop(page, 'Baths');
  const sqft          = prop(page, 'Living Area');
  const lotSize       = prop(page, 'Lot Size');
  const yearBuilt     = prop(page, 'Year Built');
  const propertyType  = prop(page, 'Property Type') || 'Single Family';
  const occupancy     = prop(page, 'Occupancy') || 'Vacant';
  const parking       = prop(page, 'Parking');
  const piti          = prop(page, 'PITI');
  const subToRate     = prop(page, 'SubTo Rate (%)');
  const subToBalance  = prop(page, 'SubTo Loan Balance');
  const sfLoanAmount  = prop(page, 'SF Loan Amount');
  const sfPayment     = prop(page, 'SF Payment');
  const sfRate        = prop(page, 'SF Rate');
  const sfTerm        = prop(page, 'SF Term');
  const cashToSeller  = prop(page, 'Cash to Seller');
  const entryFee      = prop(page, 'Entry Fee');
  const ltrRent       = prop(page, 'LTR Market Rent');
  const loanType      = prop(page, 'Loan Type');
  const nearestMetro  = prop(page, 'Nearest Metro');
  const description   = prop(page, 'Description');
  const uwVerdict     = prop(page, 'UW Verdict');
  const contractedPrice = prop(page, 'Contracted Price');
  const internalNotes = prop(page, 'Internal Notes');

  const fullAddress  = [streetAddress, city, state, zip].filter(Boolean).join(', ');
  const cityStateZip = [city, state].filter(Boolean).join(', ') + (zip ? ' ' + zip : '');
  const propertyTypeBedsBaths = [propertyType, (beds || '?') + 'BR / ' + (baths || '?') + 'BA'].filter(Boolean).join(' • ');

  const t = {};
  // Identity
  t.DEAL_ADDRESS = emOrStr(fullAddress);
  t.DEAL_ADDRESS_SHORT = emOrStr(streetAddress);
  t.CITY_STATE_ZIP = emOrStr(cityStateZip);
  t.DEAL_ID = dealId;
  t.DEAL_URL = 'https://termsforsale.com/deal.html?id=' + pageId;
  t.DEAL_STRUCTURE = emOrStr(dealType);
  t.MEMO_DATE = fmtDate(new Date().toISOString());
  // Property specs
  t.BEDROOMS = emOrStr(beds);
  t.BATHROOMS = emOrStr(baths);
  t.LIVING_SQFT = fmtNumber(sqft);
  t.LOT_SQFT = emOrStr(lotSize);
  t.YEAR_BUILT = emOrStr(yearBuilt);
  t.GARAGE = emOrStr(parking);
  t.OCCUPANCY = emOrStr(occupancy);
  t.CONDITION = EMDASH;
  t.PROPERTY_TYPE = emOrStr(propertyType);
  t.PROPERTY_TYPE_BEDS_BATHS = propertyTypeBedsBaths;
  // Top-line financial
  t.PURCHASE_PRICE = fmtMoney(askingPrice);
  t.EXISTING_RATE = fmtPct(subToRate, 3);
  t.PITI = fmtMoney(piti);
  const arvNum = parseMoneyText(arv);
  t.ARV = fmtMoney(arvNum);
  t.CASH_TO_CLOSE = fmtMoneyShort(cashToSeller != null ? cashToSeller : entryFee);
  t.MARKET_RATE_TODAY = '7.25%';
  t.MARKET_RENT = fmtMoney(ltrRent);
  // Photos (Phase 2)
  t.PHOTO_FRONT = EMDASH; t.PHOTO_KITCHEN = EMDASH; t.PHOTO_LIVING = EMDASH; t.PHOTO_PRIMARY_BED = EMDASH; t.PHOTO_BACKYARD = EMDASH;
  // Location
  t.SUBMARKET_NAME = emOrStr(nearestMetro || city);
  t.LOCATION_NARRATIVE = EMDASH; t.MAJOR_EMPLOYERS = EMDASH; t.MEDIAN_HH_INCOME = EMDASH;
  t.POP_GROWTH = EMDASH; t.RENTAL_VACANCY = EMDASH; t.SCHOOL_RATING = EMDASH;
  // Existing loan
  t.ORIGINAL_AMOUNT = EMDASH; t.ORIGINATION_DATE = EMDASH;
  t.INTEREST_RATE = fmtPct(subToRate, 3);
  t.LENDER = emOrStr(loanType); t.LOAN_TYPE = emOrStr(loanType);
  t.REMAINING_TERM = EMDASH;
  t.CURRENT_BALANCE = fmtMoney(subToBalance);
  t.ASSUMABILITY = /sub.?to/i.test(dealType || '') ? 'Sub-To' : EMDASH;
  // Sources & Uses (Phase 2)
  t.USE_PURCHASE = fmtMoney(askingPrice);
  t.USE_INSPECTION = EMDASH; t.USE_TITLE = EMDASH; t.USE_RECORDING = EMDASH;
  t.USE_INSURANCE = EMDASH; t.USE_ATTORNEY = EMDASH; t.USE_RESERVES = EMDASH; t.USES_TOTAL = EMDASH;
  t.SOURCE_CASH_DOWN = fmtMoney(cashToSeller != null ? cashToSeller : entryFee);
  t.SOURCE_CLOSING_RESERVES = EMDASH; t.SOURCES_TOTAL = EMDASH;
  // Sub-To / SF
  t.SUBTO_BALANCE = fmtMoney(subToBalance);
  t.SUBTO_RATE = fmtPct(subToRate, 3);
  t.SUBTO_REMAINING_TERM = EMDASH;
  t.SF_AMOUNT = fmtMoney(sfLoanAmount);
  t.SF_PAYMENT = fmtMoney(sfPayment);
  t.SF_RATE = fmtPct(sfRate, 3);
  t.SF_TERM = emOrStr(sfTerm);
  t.DOWN_TO_SELLER = fmtMoney(cashToSeller);
  // Rehab (Phase 2)
  t.REHAB_TOTAL = EMDASH; t.REHAB_BATHS = EMDASH; t.REHAB_KITCHEN = EMDASH; t.REHAB_HVAC = EMDASH;
  t.REHAB_FLOORING = EMDASH; t.REHAB_PAINT = EMDASH; t.REHAB_ROOF = EMDASH; t.REHAB_LANDSCAPING = EMDASH;
  t.REHAB_CONTINGENCY = EMDASH; t.REHAB_DRAWS = EMDASH; t.REHAB_DURATION = EMDASH;
  t.REHAB_TIMELINE_START = EMDASH; t.REHAB_GC_MODEL = EMDASH; t.GC_NAME = EMDASH; t.GC_BID_DATE = EMDASH;
  // Comparison table (Phase 2)
  const STRATEGIES = ['LTR', 'STR', 'BRRRR', 'FLIP', 'WRAP', 'COLIVE', 'ADU'];
  const COLUMNS = ['CASH', 'CF', 'COC', 'COC_BAR_WIDTH', 'COC_LABEL', 'COMPLEXITY', 'HORIZON', 'MARGIN', 'NOI'];
  for (const s of STRATEGIES) for (const c of COLUMNS) t['CMP_' + s + '_' + c] = EMDASH;
  // Returns / Risks / Narratives / Comps / STR / Closing — Phase 2/3
  t.BEST_CASE_COC = EMDASH; t.BEST_COC = EMDASH; t.BEST_COC_NARRATIVE = EMDASH;
  t.MAX_MONTHLY_CF = EMDASH; t.MAX_CF_NARRATIVE = EMDASH;
  t.BEST_NOI = EMDASH; t.BEST_NOI_NARRATIVE = EMDASH; t.PEAK_MONTHLY_CASHFLOW = EMDASH;
  t.RISK_DOS = EMDASH; t.RISK_EXECUTION = EMDASH; t.RISK_INSURANCE = EMDASH;
  t.RISK_RATE_RENT = EMDASH; t.RISK_REGULATORY = EMDASH; t.RISK_VACANCY = EMDASH;
  t.EXEC_HOOK = EMDASH; t.SPECS_HOOK = EMDASH; t.EQUITY_NARRATIVE = EMDASH;
  t.INPLACE_CASHFLOW_NARRATIVE = EMDASH; t.BELOW_MARKET_DEBT_NARRATIVE = EMDASH;
  t.STRESS_TESTED_EXITS_NARRATIVE = EMDASH; t.SPREAD_TO_PURCHASE_NARRATIVE = EMDASH;
  t.COMPS_METHOD = EMDASH; t.SPREAD_BPS = EMDASH;
  t.STR_ADR = EMDASH; t.STR_MEDIAN_ADR = EMDASH; t.STR_OCCUPANCY = EMDASH;
  t.STR_PRO_FORMA_GROSS = EMDASH; t.STR_REVPAR = EMDASH; t.STR_SEASONALITY = EMDASH;
  t.CLOSING_COSTS = EMDASH; t.ESCROW = EMDASH; t.HAZARD_INS = EMDASH;
  t.PROPERTY_TAX = EMDASH; t.PI = EMDASH; t.PMI = EMDASH; t.RESERVES = EMDASH;
  t.TARGET_CLOSE_DATE = EMDASH; t.TIME_TO_CLOSE = EMDASH; t.VIABLE_EXITS = EMDASH;
  // Contact
  t.COORDINATOR_NAME = 'Brooke Froehlich';
  t.COORDINATOR_TITLE = 'Co-Founder & COO, Terms For Sale';
  t.EMAIL = 'brooke@termsforsale.com';
  t.PHONE = '+1 (480) 637-3117';
  t.ACTIVE_DEAL_COUNT = EMDASH;
  // === Aliases / extras the template uses (added after smoke test caught them) ===
  t.PREPARED_FOR = 'Strategic Investor Network';
  t.DEAL_ID_SHORT = dealId.replace(/^TFS-/, '').slice(0, 8);
  t.DEAL_ADDRESS_PLAIN = emOrStr(streetAddress);
  t.COORDINATOR_EMAIL = 'brooke@termsforsale.com';
  t.COORDINATOR_PHONE = '+1 (480) 637-3117';
  t.YEAR_BUILT_2 = emOrStr(yearBuilt);
  // EXEC_HEADLINE — short hook from Description (first 90 chars), or UW Verdict, or em-dash
  t.EXEC_HEADLINE = description ? String(description).slice(0, 90).trim() : (uwVerdict ? uwVerdict : EMDASH);
  // DAY1_EQUITY_SHORT — ARV minus Purchase Price, formatted short ($185K)
  const day1Equity = (arvNum != null && askingPrice != null) ? Math.max(0, arvNum - Number(askingPrice)) : null;
  t.DAY1_EQUITY_SHORT = day1Equity != null ? fmtMoneyShort(day1Equity) : EMDASH;
  // CASH_TO_CLOSE_SHORT — for cash deals = asking price; for sub-to = cash to seller + entry fee
  const isCashDeal = /^cash\b/i.test(dealType || '');
  let cashToClose;
  if (cashToSeller != null || entryFee != null) {
    cashToClose = (Number(cashToSeller) || 0) + (Number(entryFee) || 0);
  } else if (isCashDeal && askingPrice != null) {
    cashToClose = Number(askingPrice);
  } else {
    cashToClose = null;
  }
  t.CASH_TO_CLOSE_SHORT = cashToClose != null ? fmtMoneyShort(cashToClose) : EMDASH;
  t.CASH_TO_CLOSE = t.CASH_TO_CLOSE_SHORT;
  // VIABLE_EXITS — pull from UW Verdict if present (e.g., "PASS — All-Cash + Light Rehab")
  t.VIABLE_EXITS = uwVerdict ? String(uwVerdict).split('—')[1] ? String(uwVerdict).split('—')[1].split('(')[0].trim() : uwVerdict : EMDASH;
  return t;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  const auth = verifyAdmin(event);
  if (!auth.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: auth.reason }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { pageId } = body;
  if (!pageId || typeof pageId !== 'string' || !/^[a-f0-9-]{32,36}$/i.test(pageId.replace(/-/g, ''))) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'pageId is required and must be a valid Notion page ID' }) };
  }

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return { statusCode: 500, headers, body: JSON.stringify({ error: 'NOTION_TOKEN not configured' }) };
  if (!RENDER_TOKEN) return { statusCode: 500, headers, body: JSON.stringify({ error: 'RENDER_SERVICE_TOKEN not configured' }) };

  let page;
  try {
    const pageRes = await fetch(NOTION_BASE + '/pages/' + pageId, {
      headers: { 'Authorization': 'Bearer ' + notionToken, 'Notion-Version': '2022-06-28' }
    });
    if (!pageRes.ok) {
      const t = await pageRes.text().catch(() => '');
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Notion fetch failed: ' + pageRes.status, detail: t.slice(0, 200) }) };
    }
    page = await pageRes.json();
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Notion fetch error: ' + e.message }) };
  }

  const tokens = buildTokenMap(page, pageId);
  const dealId = tokens.DEAL_ID;
  const address = tokens.DEAL_ADDRESS;
  const filledCount = Object.values(tokens).filter(v => v !== EMDASH).length;
  console.log('[generate-pitch-deck] dealId=' + dealId + ' address=' + address + ' filled=' + filledCount + '/' + Object.keys(tokens).length);

  // Fire-and-forget: kick off paperclip render. Paperclip handles full pipeline:
  // render PDF, capture screenshots, build PPTX, upload Slides + PDF to Drive,
  // and PATCH Notion Summary URL all on its own (~30-45s total).
  // Netlify returns 202 immediately so we don't trip its 26s timeout.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(RENDER_DECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': RENDER_TOKEN },
      body: JSON.stringify({
        dealId,
        tokens,
        notionPageId: pageId,
        deal: { address, dealType: tokens.DEAL_STRUCTURE }
      }),
      signal: controller.signal
    }).catch(() => {});
  } catch (e) {
    if (e.name !== 'AbortError') {
      clearTimeout(abortTimer);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Render service unreachable: ' + e.message }) };
    }
  }
  clearTimeout(abortTimer);

  return {
    statusCode: 202,
    headers,
    body: JSON.stringify({
      ok: true,
      queued: true,
      dealId,
      address,
      tokensReplaced: Object.keys(tokens).length,
      tokensFilled: filledCount,
      notionPageUrl: 'https://www.notion.so/' + pageId.replace(/-/g, ''),
      message: 'Deck render queued. Slides + PDF will appear in Drive (Deal Decks folder) and the Summary URL on this Notion page within ~30-45 seconds.'
    })
  };
};
