'use strict';

// Webshare proxy rotator.
// Webshare offers a single endpoint with rotating IP (per-request rotation enabled
// at account level), or a list of static proxies via API. We support both.
//
// Two modes:
//   1. ROTATING_ENDPOINT (preferred) — set WEBSHARE_PROXY_HOST and WEBSHARE_PROXY_PORT
//      to the rotating endpoint and Webshare assigns a new IP per request automatically.
//   2. STATIC_LIST — fetch the proxy list once via the Webshare API, rotate ourselves.
//
// If WEBSHARE_API_KEY is unset the rotator returns null (caller must handle direct mode).

const { request: undiciRequest } = require('undici');
const log = require('./log');

let cachedList = null;
let cachedAt = 0;
const LIST_TTL_MS = 60 * 60 * 1000; // refresh every 1h

async function fetchProxyList() {
  if (cachedList && Date.now() - cachedAt < LIST_TTL_MS) return cachedList;
  if (!process.env.WEBSHARE_API_KEY) return null;
  try {
    const { body, statusCode } = await undiciRequest(
      'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page_size=100',
      { headers: { Authorization: `Token ${process.env.WEBSHARE_API_KEY}` } }
    );
    if (statusCode !== 200) {
      log.warn('webshare list fetch failed', { statusCode });
      return null;
    }
    const json = await body.json();
    cachedList = (json.results || []).map(p => ({
      host: p.proxy_address,
      port: p.port,
      username: p.username,
      password: p.password,
      country_code: p.country_code
    }));
    cachedAt = Date.now();
    log.info('webshare proxy list refreshed', { count: cachedList.length });
    return cachedList;
  } catch (e) {
    log.warn('webshare list fetch error', { error: e.message });
    return null;
  }
}

let rrIdx = 0;
async function pickProxy() {
  // Rotating endpoint preferred
  if (process.env.WEBSHARE_PROXY_HOST && process.env.WEBSHARE_PROXY_PORT) {
    return {
      host: process.env.WEBSHARE_PROXY_HOST,
      port: Number(process.env.WEBSHARE_PROXY_PORT),
      username: process.env.WEBSHARE_PROXY_USER,
      password: process.env.WEBSHARE_PROXY_PASS
    };
  }
  const list = await fetchProxyList();
  if (!list || !list.length) return null;
  const p = list[rrIdx % list.length];
  rrIdx++;
  return p;
}

function proxyUrl(p) {
  if (!p) return null;
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@` : '';
  return `http://${auth}${p.host}:${p.port}`;
}

const USER_AGENTS = [
  // Recent stable Chrome / Firefox / Safari pool, rotated per request
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

module.exports = { pickProxy, proxyUrl, pickUserAgent };
