'use strict';

// Lightweight HTTP fetcher for static-HTML scrapers (BizBuySell, Craigslist, MHPFinder, FSBO).
// Uses undici (native, fast) with proxy + UA rotation.

const { request: undiciRequest, ProxyAgent } = require('undici');
const { pickProxy, proxyUrl, pickUserAgent } = require('./proxy-rotator');
const log = require('./log');
const { jitterDelay } = require('./parser-helpers');

async function fetchHtml(url, opts = {}) {
  const proxy = await pickProxy();
  const dispatcher = proxy ? new ProxyAgent({ uri: proxyUrl(proxy) }) : undefined;
  const userAgent = opts.userAgent || pickUserAgent();

  // Polite delay before each request to avoid hammering
  if (opts.rateLimitMs !== 0) {
    await jitterDelay(Number(opts.rateLimitMs) || Number(process.env.SCRAPE_RATE_LIMIT_MS) || 4000);
  }

  let res;
  try {
    res = await undiciRequest(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      dispatcher,
      bodyTimeout: 25_000,
      headersTimeout: 25_000
    });
  } catch (e) {
    log.warn('cheerio-fetch error', { url, error: e.message });
    throw e;
  }
  const body = await res.body.text();
  return { html: body, status: res.statusCode };
}

module.exports = { fetchHtml };
