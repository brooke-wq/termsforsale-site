'use strict';

// Thin Playwright wrapper for JS-heavy sites (LoopNet, Crexi).
// Boots Chromium with proxy + UA rotation; tears down per call.
//
// Usage:
//   const { fetchPageHtml } = require('./playwright-fetch');
//   const html = await fetchPageHtml(url, { waitForSelector: '...', timeoutMs: 30_000 });

const { chromium } = require('playwright');
const { pickProxy, proxyUrl, pickUserAgent } = require('./proxy-rotator');
const log = require('./log');
const { jitterDelay } = require('./parser-helpers');

const DEFAULT_TIMEOUT = 30_000;

async function fetchPageHtml(url, opts = {}) {
  const proxy = await pickProxy();
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  };
  if (proxy) {
    launchOpts.proxy = {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password
    };
  }

  const browser = await chromium.launch(launchOpts);
  let html = '';
  let status = null;

  try {
    const ctx = await browser.newContext({
      userAgent: opts.userAgent || pickUserAgent(),
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/Phoenix'
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(opts.timeoutMs || DEFAULT_TIMEOUT);

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
    status = resp ? resp.status() : null;

    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: opts.timeoutMs || DEFAULT_TIMEOUT })
        .catch(() => log.debug('selector wait timed out', { url, sel: opts.waitForSelector }));
    } else {
      // Give the page a beat for SPA hydration
      await jitterDelay(1500);
    }

    html = await page.content();
    await ctx.close();
  } catch (e) {
    log.warn('playwright fetch error', { url, error: e.message, status });
    throw Object.assign(new Error(e.message), { status, source_url: url });
  } finally {
    await browser.close().catch(() => {});
  }

  return { html, status };
}

module.exports = { fetchPageHtml };
