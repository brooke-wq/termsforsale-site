'use strict';

// Crexi scraper.
// Crexi exposes a JSON API for search results that's far more reliable to scrape
// than parsing HTML. We hit the same endpoint the SPA uses internally:
//   https://api.crexi.com/assets/search/...
//
// The endpoint is stable but unofficial. If it changes, the fallback path is to
// load the search page in Playwright and parse the embedded __NEXT_DATA__ JSON.
//
// IMPORTANT: this scraper is implemented end-to-end against the *current* Crexi
// API contract as of April 2026. If the API breaks, the fallback Playwright path
// below also needs to be enabled (see CREXI_FALLBACK_PLAYWRIGHT below).

const cheerio = require('cheerio');
const { fetchPageHtml } = require('../lib/playwright-fetch');
const { fetchHtml } = require('../lib/cheerio-fetch');
const { jitterDelay, parsePrice, parseUnits, parseYearBuilt, parseAcres } = require('../lib/parser-helpers');
const log = require('../lib/log');

// Crexi search URLs by asset class.
// The "types[0]=" filter narrows to the right product. Additional facets:
//   priceMin / priceMax / askingPriceMin / askingPriceMax
//   units min/max → not exposed as URL params; we filter post-fetch
const CREXI_SEARCH = {
  mf: 'https://api.crexi.com/assets/search?types%5B0%5D=multifamily&pageSize=60&sortBy=ListedDate&sortDescending=true&page=',
  mhp: 'https://api.crexi.com/assets/search?types%5B0%5D=specialPurpose&types%5B1%5D=land&query=mobile%20home%20park&pageSize=60&sortBy=ListedDate&sortDescending=true&page='
};

// Fallback (Playwright HTML parse) — only used if the API path fails 3+ times in a row
const CREXI_FALLBACK = {
  mf: 'https://www.crexi.com/properties?types=multifamily&sortBy=ListedDate&sortDescending=true&page=',
  mhp: 'https://www.crexi.com/properties?types=specialPurpose&search=mobile+home+park&sortBy=ListedDate&sortDescending=true&page='
};

async function scrapeApi(searchUrl, page) {
  const url = `${searchUrl}${page}`;
  const { html, status } = await fetchHtml(url, { rateLimitMs: 4500 });
  if (status !== 200) {
    throw Object.assign(new Error(`crexi api status ${status}`), { status });
  }
  let json;
  try {
    json = JSON.parse(html);
  } catch (e) {
    throw new Error(`crexi api non-JSON response: ${html.slice(0, 200)}`);
  }
  return json;
}

function extractFromApiItem(item, assetClass) {
  // Crexi API field names — observed empirically. Fall back gracefully when missing.
  const id   = item.id || item.assetId;
  const slug = item.urlSlug || item.slug;
  if (!id || !slug) return null;

  const source_url = `https://www.crexi.com/properties/${id}/${slug}`;
  const address    = item.address || item.streetAddress || null;
  const city       = item.city || (item.location && item.location.city) || null;
  const state      = item.state || item.stateCode || (item.location && item.location.state) || null;
  const zip        = item.zip || item.zipCode || (item.location && item.location.zip) || null;
  const county     = item.county || (item.location && item.location.county) || null;

  const listing_price = item.askingPrice ?? item.price ?? null;
  const units         = item.units ?? item.numberOfUnits ?? null;
  const year_built    = item.yearBuilt ?? null;
  const lot_size      = item.lotSizeAcres ?? item.acres ?? null;

  return {
    source: 'crexi',
    source_url,
    asset_class: assetClass,
    address, city, state, zip, county,
    listing_price, units, year_built, lot_size,
    raw: item
  };
}

async function scrapePlaywrightFallback(searchUrl, page, assetClass) {
  const url = `${searchUrl}${page}`;
  log.info('crexi fallback playwright fetch', { url });
  const { html } = await fetchPageHtml(url, { waitForSelector: '[data-testid="property-tile"], .property-card, .search-result-card', timeoutMs: 35_000 });
  const $ = cheerio.load(html);

  const records = [];
  $('a[href^="/properties/"], a[href*="/properties/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const m = href.match(/\/properties\/(\d+)\/([\w-]+)/);
    if (!m) return;
    const source_url = `https://www.crexi.com${href.split('?')[0]}`;
    const card = $(el).closest('[data-testid="property-tile"], .property-card, article');
    const text = card.text().replace(/\s+/g, ' ').trim();
    const r = {
      source: 'crexi',
      source_url,
      asset_class: assetClass,
      address: card.find('[data-testid="address"], .address').first().text().trim() || null,
      city: card.find('[data-testid="city"], .city').first().text().trim() || null,
      state: card.find('[data-testid="state"], .state').first().text().trim() || null,
      zip: null,
      county: null,
      listing_price: parsePrice(text),
      units: parseUnits(text),
      year_built: parseYearBuilt(text),
      lot_size: parseAcres(text),
      raw: { text, href }
    };
    records.push(r);
  });
  return records;
}

async function scrape(opts = {}) {
  const cap = Math.max(1, Math.min(Number(opts.maxListings) || 200, 600));
  const assetClasses = opts.assetClasses || ['mf', 'mhp'];
  const all = [];
  let apiFailures = 0;

  for (const cls of assetClasses) {
    const baseApi = CREXI_SEARCH[cls];
    const baseFallback = CREXI_FALLBACK[cls];
    let page = 1;
    let pulled = 0;

    while (pulled < cap) {
      let items = null;
      try {
        const j = await scrapeApi(baseApi, page);
        items = (j.data || j.results || []).map(it => extractFromApiItem(it, cls)).filter(Boolean);
        log.debug('crexi api page', { cls, page, items: items.length });
      } catch (e) {
        apiFailures++;
        log.warn('crexi api fetch failed', { cls, page, err: e.message, status: e.status, apiFailures });
        if (apiFailures >= 3) {
          // Fall back to Playwright HTML for the remainder of this asset class
          log.info('crexi: switching to Playwright fallback', { cls, page });
          try {
            items = await scrapePlaywrightFallback(baseFallback, page, cls);
          } catch (e2) {
            log.error('crexi fallback also failed', { cls, page, err: e2.message });
            break;
          }
        } else {
          await jitterDelay(8000);
          continue; // retry same page
        }
      }

      if (!items || !items.length) break;
      all.push(...items);
      pulled += items.length;
      page++;

      if (page > 20) break; // hard ceiling
      await jitterDelay(Number(process.env.SCRAPE_RATE_LIMIT_MS) || 4000);
    }
  }

  return all;
}

module.exports = { scrape };
