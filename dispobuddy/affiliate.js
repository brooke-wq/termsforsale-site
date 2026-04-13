/**
 * Dispo Buddy — Affiliate Tracker (client-side)
 *
 * Drops a 90-day attribution cookie whenever a visitor lands with ?ref=<code>.
 * Fires a click event to /api/affiliate-track and auto-injects the affiliate_id
 * into any form submission so backend functions can attribute conversions.
 *
 * Usage on any page:
 *   <script src="/affiliate.js" defer></script>
 *
 * Public API (window.DBAffiliate):
 *   .getId()                     -> current stored affiliate id (or null)
 *   .getAttribution()            -> full attribution object
 *   .attachToPayload(data)       -> mutates payload with affiliate_id + landing info
 *   .buildLink(id, path)         -> build a share URL for a given affiliate id
 *   .clear()                     -> wipe stored attribution (for testing)
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'dispobuddy_affiliate';
  var COOKIE_NAME = 'dispobuddy_ref';
  var TTL_DAYS    = 90;
  var TRACK_URL   = '/.netlify/functions/affiliate-track';

  // ── cookie helpers ──────────────────────────────────────────
  function setCookie(name, value, days) {
    try {
      var d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      document.cookie = name + '=' + encodeURIComponent(value) +
        ';expires=' + d.toUTCString() +
        ';path=/;SameSite=Lax';
    } catch (e) {}
  }
  function getCookie(name) {
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].trim().split('=');
        if (kv[0] === name) return decodeURIComponent(kv[1] || '');
      }
    } catch (e) {}
    return '';
  }

  // ── storage helpers ─────────────────────────────────────────
  function loadAttr() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.id) return null;
      // Expire after TTL_DAYS
      if (obj.landed_at && (Date.now() - obj.landed_at) > TTL_DAYS * 86400000) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return obj;
    } catch (e) {
      return null;
    }
  }
  function saveAttr(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function clearAttr() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    setCookie(COOKIE_NAME, '', -1);
  }

  // ── normalize affiliate code ───────────────────────────────
  function normalizeId(raw) {
    if (!raw) return '';
    return String(raw).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  }

  // ── read ?ref / ?aff / ?affiliate from current URL ─────────
  function readRefParam() {
    try {
      var params = new URLSearchParams(window.location.search);
      var candidates = ['ref', 'aff', 'affiliate', 'affid'];
      for (var i = 0; i < candidates.length; i++) {
        var v = params.get(candidates[i]);
        if (v) return normalizeId(v);
      }
    } catch (e) {}
    return '';
  }

  // ── capture flow on page load ──────────────────────────────
  var incomingRef = readRefParam();
  var existing    = loadAttr();
  var cookieRef   = normalizeId(getCookie(COOKIE_NAME));

  // New click from a ?ref param always refreshes attribution (last-click model)
  if (incomingRef) {
    var attr = {
      id: incomingRef,
      landed_at: Date.now(),
      landing_page: window.location.pathname + window.location.search,
      referrer: document.referrer || '',
      utm_source:   new URLSearchParams(window.location.search).get('utm_source') || '',
      utm_medium:   new URLSearchParams(window.location.search).get('utm_medium') || '',
      utm_campaign: new URLSearchParams(window.location.search).get('utm_campaign') || '',
    };
    saveAttr(attr);
    setCookie(COOKIE_NAME, incomingRef, TTL_DAYS);

    // Fire click beacon (non-blocking, best-effort)
    try {
      var payload = JSON.stringify({
        event: 'click',
        affiliate_id: incomingRef,
        landing_page: attr.landing_page,
        referrer: attr.referrer,
        utm_source: attr.utm_source,
        utm_medium: attr.utm_medium,
        utm_campaign: attr.utm_campaign,
        user_agent: navigator.userAgent || '',
      });
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(TRACK_URL, blob);
      } else {
        fetch(TRACK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {}
  } else if (!existing && cookieRef) {
    // Rehydrate from cookie if localStorage was cleared
    saveAttr({
      id: cookieRef,
      landed_at: Date.now(),
      landing_page: window.location.pathname,
      referrer: document.referrer || '',
    });
  }

  // ── public API ─────────────────────────────────────────────
  function getAttribution() { return loadAttr(); }
  function getId() {
    var a = loadAttr();
    return a ? a.id : '';
  }
  function attachToPayload(data) {
    if (!data || typeof data !== 'object') return data;
    var a = loadAttr();
    if (!a || !a.id) return data;
    data.affiliate_id     = a.id;
    data.affiliate_landed = a.landed_at || null;
    data.affiliate_landing_page = a.landing_page || '';
    if (a.referrer && !data.referrer) data.referrer = a.referrer;
    return data;
  }
  function buildLink(id, path) {
    var clean = normalizeId(id);
    if (!clean) return '';
    var origin = (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : 'https://dispobuddy.netlify.app';
    var p = path || '/';
    var sep = p.indexOf('?') >= 0 ? '&' : '?';
    return origin + p + sep + 'ref=' + encodeURIComponent(clean);
  }

  window.DBAffiliate = {
    getId: getId,
    getAttribution: getAttribution,
    attachToPayload: attachToPayload,
    buildLink: buildLink,
    clear: clearAttr,
  };

  // ── auto-inject hidden field on any form that has one of the
  //    known form IDs or an [data-db-attach-affiliate] attribute ──
  function injectHiddenField(form) {
    if (!form || form.querySelector('input[name="affiliate_id"]')) return;
    var a = loadAttr();
    if (!a || !a.id) return;
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'affiliate_id';
    input.value = a.id;
    form.appendChild(input);
  }
  function autoWire() {
    var selectors = [
      '#joinForm',
      '#dealForm',
      '#contactForm',
      '#submitDealForm',
      'form[data-db-attach-affiliate]',
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(injectHiddenField);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoWire);
  } else {
    autoWire();
  }
})();
