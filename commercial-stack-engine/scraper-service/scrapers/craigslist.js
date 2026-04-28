'use strict';

// Craigslist scraper.
// Craigslist is a goldmine for mom-and-pop deals — many sellers list here AS WELL
// AS LoopNet, but the Craigslist version often has the owner's direct phone
// number. We loop through major US metros and search the "real estate for sale"
// section ('rea') with relevant keywords.
//
// Static HTML, very friendly to Cheerio. Light anti-bot — but we still rotate
// IPs because Craigslist blocks aggressive scraping per IP.
//
// STATUS: SKELETON — selectors are stable but the metro list should be reviewed.

const cheerio = require('cheerio');
const { fetchHtml } = require('../lib/cheerio-fetch');
const { parsePrice, parseUnits, parseAddress, jitterDelay } = require('../lib/parser-helpers');
const log = require('../lib/log');

// Top metros to loop. Each is the Craigslist subdomain (without https://).
const METROS = [
  'phoenix', 'tucson', 'losangeles', 'sandiego', 'orangecounty', 'inlandempire',
  'sfbay', 'sacramento', 'dallas', 'houston', 'austin', 'sanantonio',
  'atlanta', 'tampa', 'orlando', 'miami', 'jacksonville', 'tallahassee',
  'lasvegas', 'reno', 'denver', 'coloradosprings', 'seattle', 'portland',
  'philadelphia', 'pittsburgh', 'newyork', 'longisland', 'chicago',
  'indianapolis', 'columbus', 'cleveland', 'cincinnati', 'detroit',
  'kansascity', 'stlouis', 'minneapolis', 'milwaukee', 'nashville', 'memphis',
  'charlotte', 'raleigh', 'newjersey', 'boston', 'baltimore', 'dc'
];

const QUERIES = {
  mf: ['apartment+building', 'apartment+complex', 'multifamily', 'fourplex+plus', 'multi-family', 'apartment+building+for+sale'],
  mhp: ['mobile+home+park', 'rv+park', 'manufactured+home+park']
};

function metroState(metro) {
  // Mapping a Craigslist subdomain to a state. Best-effort — used only as a hint.
  const map = {
    phoenix:'AZ', tucson:'AZ',
    losangeles:'CA', sandiego:'CA', orangecounty:'CA', inlandempire:'CA', sfbay:'CA', sacramento:'CA',
    dallas:'TX', houston:'TX', austin:'TX', sanantonio:'TX',
    atlanta:'GA',
    tampa:'FL', orlando:'FL', miami:'FL', jacksonville:'FL', tallahassee:'FL',
    lasvegas:'NV', reno:'NV',
    denver:'CO', coloradosprings:'CO',
    seattle:'WA', portland:'OR',
    philadelphia:'PA', pittsburgh:'PA',
    newyork:'NY', longisland:'NY',
    chicago:'IL',
    indianapolis:'IN',
    columbus:'OH', cleveland:'OH', cincinnati:'OH',
    detroit:'MI',
    kansascity:'MO', stlouis:'MO',
    minneapolis:'MN', milwaukee:'WI',
    nashville:'TN', memphis:'TN',
    charlotte:'NC', raleigh:'NC',
    newjersey:'NJ', boston:'MA', baltimore:'MD', dc:'DC'
  };
  return map[metro] || null;
}

async function scrape(opts = {}) {
  const cap = Math.max(1, Math.min(Number(opts.maxListings) || 200, 500));
  const all = [];
  const metroLimit = Math.min(Number(opts.metroLimit) || METROS.length, METROS.length);
  const assetClasses = opts.assetClasses || ['mf', 'mhp'];

  for (const cls of assetClasses) {
    for (let i = 0; i < metroLimit && all.length < cap; i++) {
      const metro = METROS[i];
      const stateHint = metroState(metro);
      for (const q of QUERIES[cls]) {
        const url = `https://${metro}.craigslist.org/search/rea?query=${q}&hasPic=1&srchType=A`;
        let html;
        try {
          const r = await fetchHtml(url, { rateLimitMs: 5000 });
          if (r.status !== 200) {
            log.warn('craigslist non-200', { metro, q, status: r.status });
            continue;
          }
          html = r.html;
        } catch (e) {
          log.warn('craigslist fetch error', { metro, q, err: e.message });
          continue;
        }
        const $ = cheerio.load(html);
        $('li.result-row, li.cl-search-result, .cl-static-search-result').each((_, el) => {
          const $el = $(el);
          const link = $el.find('a.result-title, a.titlestring, a.posting-title').first();
          const href = link.attr('href');
          if (!href) return;
          const source_url = href.startsWith('http') ? href : `https://${metro}.craigslist.org${href}`;
          const text = $el.text().replace(/\s+/g, ' ').trim();
          const addr = parseAddress($el.find('.result-hood, .meta').first().text() || text);

          all.push({
            source: 'craigslist',
            source_url,
            asset_class: cls,
            address: addr.address,
            city:    addr.city,
            state:   addr.state || stateHint,
            zip:     addr.zip,
            county:  null,
            listing_price: parsePrice(text),
            units:         parseUnits(text),
            year_built:    null,
            lot_size:      null,
            raw: { metro, query: q, text: text.slice(0, 400) }
          });
          if (all.length >= cap) return false; // break .each
        });
        await jitterDelay(5000);
        if (all.length >= cap) break;
      }
    }
  }

  return all;
}

module.exports = { scrape };
