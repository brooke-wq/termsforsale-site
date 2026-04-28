'use strict';

// Canonical listing shape used everywhere downstream.
// Every scraper MUST return objects matching this schema (or null fields where
// the source doesn't expose the data).
//
// {
//   source:        'crexi' | 'loopnet' | 'craigslist' | 'bizbuysell' | 'mhpfinder' | 'fsbo'
//   source_url:    'https://www.crexi.com/...'
//   asset_class:   'mf' | 'mhp'
//   address:       '123 Main St'
//   city:          'Phoenix'
//   state:         'AZ'  (2-letter)
//   zip:           '85016'
//   county:        'Maricopa' (best-effort, may be null)
//   listing_price: 1750000  (number, USD)
//   units:         12       (integer; for MHP this is pad count)
//   year_built:    1972
//   lot_size:      2.4      (acres)
//   raw:           { ...whatever fields the source had... }
// }

const STATE_ABBR = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
]);

function toState(s) {
  if (!s) return null;
  const u = String(s).trim().toUpperCase();
  return STATE_ABBR.has(u) ? u : null;
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[$,\s]/g, '').replace(/[^0-9.\-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNumber(v);
  return n == null ? null : Math.trunc(n);
}

function passesAssetFilters(rec) {
  if (rec.asset_class === 'mf') {
    if (rec.units != null && (rec.units < 5 || rec.units > 50)) return false;
  }
  // MHP: any size accepted
  return true;
}

function normalizeListing(rec) {
  if (!rec || !rec.source || !rec.source_url || !rec.asset_class) return null;
  const out = {
    source:        String(rec.source),
    source_url:    String(rec.source_url),
    asset_class:   rec.asset_class === 'mhp' ? 'mhp' : 'mf',
    address:       rec.address ? String(rec.address).trim() : null,
    city:          rec.city ? String(rec.city).trim() : null,
    state:         toState(rec.state),
    zip:           rec.zip ? String(rec.zip).replace(/[^0-9]/g, '').slice(0, 5) || null : null,
    county:        rec.county ? String(rec.county).trim() : null,
    listing_price: toNumber(rec.listing_price),
    units:         toInt(rec.units),
    year_built:    toInt(rec.year_built),
    lot_size:      toNumber(rec.lot_size),
    raw:           rec.raw || {}
  };
  if (!passesAssetFilters(out)) return null;
  return out;
}

module.exports = { normalizeListing, toNumber, toInt, toState };
