'use strict';

// BizBuySell scraper.
// BizBuySell hosts mom-and-pop park listings under the "RV Parks/Campgrounds &
// Mobile Home Parks" category. Static HTML, friendly to Cheerio.
//
// STATUS: SKELETON. Selectors below match the layout observed in early 2026 but
// BizBuySell occasionally rolls out template tweaks. Run with --dry-run to verify.

const cheerio = require('cheerio');
const { fetchHtml } = require('../lib/cheerio-fetch');
const { parsePrice, parseUnits, parseAcres, parseAddress, jitterDelay } = require('../lib/parser-helpers');
const log = require('../lib/log');

const BBS_SEARCH = {
  // Mobile Home / RV Parks. asset_class = mhp
  mhp: 'https://www.bizbuysell.com/rv-parks-mobile-home-parks-for-sale/'
};

async function scrape(opts = {}) {
  const cap = Math.max(1, Math.min(Number(opts.maxListings) || 100, 400));
  const all = [];
  const assetClasses = opts.assetClasses || ['mhp'];

  for (const cls of assetClasses) {
    const base = BBS_SEARCH[cls];
    if (!base) continue;
    let page = 1;
    let pulled = 0;

    while (pulled < cap) {
      const url = page === 1 ? base : `${base}?page=${page}`;
      let html;
      try {
        const r = await fetchHtml(url, { rateLimitMs: 4500 });
        if (r.status !== 200) {
          log.warn('bizbuysell non-200', { url, status: r.status });
          break;
        }
        html = r.html;
      } catch (e) {
        log.warn('bizbuysell fetch error', { url, err: e.message });
        break;
      }
      const $ = cheerio.load(html);
      const items = [];
      $('.diamond, .basicListing, .listing, [data-listing-id]').each((_, el) => {
        const $el = $(el);
        const link = $el.find('a[href*="/Business-For-Sale/"], a[href*="/business-opportunity/"]').first();
        const href = link.attr('href');
        if (!href) return;
        const source_url = href.startsWith('http') ? href : `https://www.bizbuysell.com${href}`;
        const text = $el.text().replace(/\s+/g, ' ').trim();
        const addr = parseAddress($el.find('.location, .listing-location').first().text() || text);

        items.push({
          source: 'bizbuysell',
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
          lot_size:      parseAcres(text),
          raw: { html_snippet: $el.html() ? $el.html().slice(0, 1500) : null, text: text.slice(0, 500) }
        });
      });

      if (!items.length) break;
      all.push(...items);
      pulled += items.length;
      page++;
      if (page > 10) break;
      await jitterDelay(4500);
    }
  }
  return all;
}

module.exports = { scrape };
