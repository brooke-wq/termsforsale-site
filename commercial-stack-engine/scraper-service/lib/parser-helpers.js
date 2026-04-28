'use strict';

// Common parsing helpers used by multiple scrapers.

const ZIP_RE = /\b(\d{5})(-\d{4})?\b/;
const STATE_CITY_ZIP_RE = /([A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5})/;
const PRICE_RE = /\$([\d,]+(?:\.\d{1,2})?)(?:\s*([KMB]))?/i;
const UNITS_RE = /(\d{1,4})\s*(?:units?|doors?|apartments?|pads?|sites?|spaces?)/i;
const YEAR_RE = /(?:built|year built|yr\.?\s*built|circa)\s*[:\s]*?(19\d{2}|20\d{2})/i;
const ACRES_RE = /([\d.]+)\s*(?:acres?|ac\b)/i;

function parsePrice(text) {
  if (!text) return null;
  const m = String(text).match(PRICE_RE);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') n *= 1_000;
  else if (suffix === 'M') n *= 1_000_000;
  else if (suffix === 'B') n *= 1_000_000_000;
  return n;
}

function parseUnits(text) {
  if (!text) return null;
  const m = String(text).match(UNITS_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseYearBuilt(text) {
  if (!text) return null;
  const m = String(text).match(YEAR_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseAcres(text) {
  if (!text) return null;
  const m = String(text).match(ACRES_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseAddress(text) {
  if (!text) return { address: null, city: null, state: null, zip: null };
  const t = String(text).trim();
  const cityStateZip = t.match(STATE_CITY_ZIP_RE);
  if (cityStateZip) {
    const beforeIdx = t.indexOf(cityStateZip[0]);
    const street = beforeIdx > 0 ? t.slice(0, beforeIdx).replace(/[,\s]+$/, '').trim() : null;
    return {
      address: street || null,
      city: cityStateZip[1].trim(),
      state: cityStateZip[2],
      zip: cityStateZip[3]
    };
  }
  // Fall-back: look for ZIP only
  const z = t.match(ZIP_RE);
  return { address: t || null, city: null, state: null, zip: z ? z[1] : null };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jitterDelay(baseMs) {
  const jitter = Math.floor(Math.random() * baseMs * 0.5);
  return sleep(baseMs + jitter);
}

module.exports = {
  parsePrice, parseUnits, parseYearBuilt, parseAcres, parseAddress,
  sleep, jitterDelay,
  ZIP_RE, STATE_CITY_ZIP_RE, PRICE_RE, UNITS_RE, YEAR_RE, ACRES_RE
};
