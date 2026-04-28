'use strict';

// FSBO aggregator — pulls from ForSaleByOwner.com and Zillow's FSBO commercial
// surface. FSBO sellers are often highly motivated (no agent, direct deal).
//
// STATUS: SKELETON — both targets are static HTML, but Zillow has aggressive
// anti-bot. ForSaleByOwner is reliably scrapable. Start with FSBO.com only,
// add Zillow later if/when LoopNet+Crexi+BizBuySell+MHPFinder coverage gaps
// make it worthwhile.

const cheerio = require('cheerio');
const { fetchHtml } = require('../lib/cheerio-fetch');
const { parsePrice, parseUnits, parseAddress, jitterDelay } = require('../lib/parser-helpers');
const log = require('../lib/log');

const FSBO_BASE = 'https://www.forsalebyowner.com';
// MF: search by property type "multi-family"
const FSBO_SEARCH = {
  mf: `${FSBO_BASE}/buy/listings?propertyType=multi-family&page=`,
  // FSBO doesn't have a dedicated MHP filter; skip MHP here, rely on
  // BizBuySell + MHPFinder for that asset class.
};

async function scrape(opts = {}) {
  const cap = Math.max(1, Math.min(Number(opts.maxListings) || 80, 200));
  const all = [];
  const assetClasses = (opts.assetClasses || ['mf']).filter(c => FSBO_SEARCH[c]);

  for (const cls of assetClasses) {
    let page = 1;
    while (all.length < cap) {
      const url = `${FSBO_SEARCH[cls]}${page}`;
      let html;
      try {
        const r = await fetchHtml(url, { rateLimitMs: 4500 });
        if (r.status !== 200) {
          log.warn('fsbo non-200', { url, status: r.status });
          break;
        }
        html = r.html;
      } catch (e) {
        log.warn('fsbo fetch error', { url, err: e.message });
        break;
      }
      const $ = cheerio.load(html);
      const items = [];
      $('article.listing, [data-listing-id], .property-card').each((_, el) => {
        const $el = $(el);
        const link = $el.find('a[href*="/listing/"], a[href*="/property/"]').first();
        const href = link.attr('href');
        if (!href) return;
        const source_url = href.startsWith('http') ? href : `${FSBO_BASE}${href}`;
        const text = $el.text().replace(/\s+/g, ' ').trim();
        const addr = parseAddress($el.find('.address, .location').first().text() || text);

        items.push({
          source: 'fsbo',
          source_url,
          asset_class: cls,
          address: addr.address,
          city:    addr.city,
          state:   addr.state,
          zip:     addr.zip,
          county:  null,
          listing_price: parsePrice(text),
          units:         parseUnits(text),
          year_built:    null,
          lot_size:      null,
          raw: { text: text.slice(0, 500) }
        });
      });

      if (!items.length) break;
      all.push(...items);
      page++;
      if (page > 8) break;
      await jitterDelay(4500);
    }
  }
  return all;
}

module.exports = { scrape };
