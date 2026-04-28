'use strict';

// LoopNet scraper.
// LoopNet has the most aggressive anti-bot stack of the targets:
//   - Akamai + DataDome + Cloudflare layered
//   - Browser fingerprint checks (TLS + JS challenges)
//   - Aggressive rate limiting per IP
//
// Strategy:
//   1. Use Playwright with residential proxies (Webshare).
//   2. Randomize UA, viewport, timezone per session.
//   3. Keep pace at 1 request per 6-8s, jittered.
//   4. Land on the search page, wait for hydration, parse __NEXT_DATA__ embedded JSON
//      (LoopNet is Next.js). The JSON tree contains the full search result set
//      already deserialized — much cleaner than scraping the rendered DOM.
//
// STATUS: SKELETON. Selectors below are the right shape but need verification
// against a live page during the first dev pass. Run with --dry-run to inspect
// the captured raw_json before flipping live scraping on.

const cheerio = require('cheerio');
const { fetchPageHtml } = require('../lib/playwright-fetch');
const { jitterDelay, parsePrice, parseUnits, parseYearBuilt } = require('../lib/parser-helpers');
const log = require('../lib/log');

const LOOPNET_SEARCH = {
  // 5-50 unit MF, sorted newest first
  mf: 'https://www.loopnet.com/search/multifamily-properties/usa/for-sale/?propertytype=multifamily&unitsfrom=5&unitsto=50&sortby=Newest&page=',
  mhp: 'https://www.loopnet.com/search/mobile-home-parks/usa/for-sale/?sortby=Newest&page='
};

function parseNextData($) {
  const raw = $('script#__NEXT_DATA__').html();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    log.warn('loopnet __NEXT_DATA__ parse failed', { err: e.message });
    return null;
  }
}

function flattenSearchResults(nextData) {
  // The deeply-nested path is brittle. Look for any array containing objects
  // that have an "address" + "askingPrice" / "price" pair — that's almost
  // certainly the result set.
  const found = [];
  function walk(node, depth) {
    if (depth > 8 || !node) return;
    if (Array.isArray(node)) {
      // Array of listings?
      if (node.length && node[0] && typeof node[0] === 'object'
          && (node[0].address || node[0].listingId)
          && (node[0].askingPrice != null || node[0].price != null || node[0].priceText)) {
        found.push(...node);
        return;
      }
      for (const n of node) walk(n, depth + 1);
    } else if (typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], depth + 1);
    }
  }
  walk(nextData, 0);
  return found;
}

function extractFromItem(item, assetClass) {
  const url = item.detailUrl || item.url || item.canonicalUrl;
  if (!url) return null;
  const source_url = url.startsWith('http') ? url : `https://www.loopnet.com${url}`;
  return {
    source: 'loopnet',
    source_url,
    asset_class: assetClass,
    address: item.address || null,
    city:    item.city || (item.location && item.location.city) || null,
    state:   item.state || (item.location && item.location.state) || null,
    zip:     item.zipCode || item.zip || (item.location && item.location.zip) || null,
    county:  null,
    listing_price: item.askingPrice ?? item.price ?? parsePrice(item.priceText),
    units:         item.units ?? item.numberOfUnits ?? parseUnits(item.title || ''),
    year_built:    item.yearBuilt ?? null,
    lot_size:      item.lotSizeAcres ?? null,
    raw: item
  };
}

async function scrape(opts = {}) {
  const cap = Math.max(1, Math.min(Number(opts.maxListings) || 100, 400));
  const assetClasses = opts.assetClasses || ['mf', 'mhp'];
  const all = [];

  for (const cls of assetClasses) {
    const base = LOOPNET_SEARCH[cls];
    let page = 1;
    let pulled = 0;
    while (pulled < cap) {
      const url = `${base}${page}`;
      let html;
      try {
        const r = await fetchPageHtml(url, {
          waitForSelector: 'script#__NEXT_DATA__',
          timeoutMs: 40_000
        });
        html = r.html;
      } catch (e) {
        log.warn('loopnet fetch failed', { url, err: e.message, status: e.status });
        break;
      }
      const $ = cheerio.load(html);
      const nd = parseNextData($);
      if (!nd) break;
      const items = flattenSearchResults(nd).map(it => extractFromItem(it, cls)).filter(Boolean);
      if (!items.length) break;

      all.push(...items);
      pulled += items.length;
      page++;
      if (page > 10) break;
      await jitterDelay(7000);
    }
  }

  return all;
}

module.exports = { scrape };
