'use strict';

// MHPFinder scraper.
// MHPFinder is a niche directory of mom-and-pop mobile home park listings.
// Smaller inventory but very high signal — most listings are FSBO and the
// owners often have 80%+ equity (multi-decade hold periods).
//
// Static HTML. Listing cards on the index page link to detail pages.
//
// STATUS: SKELETON — verify selectors with --dry-run on first run.

const cheerio = require('cheerio');
const { fetchHtml } = require('../lib/cheerio-fetch');
const { parsePrice, parseUnits, parseAddress, jitterDelay } = require('../lib/parser-helpers');
const log = require('../lib/log');

const BASE = 'https://mhpfinder.com';
const SEARCH = `${BASE}/properties/`;

async function scrape(opts = {}) {
  const cap = Math.max(1, Math.min(Number(opts.maxListings) || 80, 200));
  const all = [];
  let page = 1;

  while (all.length < cap) {
    const url = page === 1 ? SEARCH : `${SEARCH}page/${page}/`;
    let html;
    try {
      const r = await fetchHtml(url, { rateLimitMs: 4000 });
      if (r.status !== 200) {
        log.warn('mhpfinder non-200', { url, status: r.status });
        break;
      }
      html = r.html;
    } catch (e) {
      log.warn('mhpfinder fetch error', { url, err: e.message });
      break;
    }
    const $ = cheerio.load(html);
    const items = [];
    $('.property-card, article.property, [data-property-id]').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a[href*="/properties/"]').first();
      const href = link.attr('href');
      if (!href) return;
      const source_url = href.startsWith('http') ? href : `${BASE}${href}`;
      const text = $el.text().replace(/\s+/g, ' ').trim();
      const addr = parseAddress($el.find('.address, .location').first().text() || text);

      items.push({
        source: 'mhpfinder',
        source_url,
        asset_class: 'mhp',
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
  return all;
}

module.exports = { scrape };
