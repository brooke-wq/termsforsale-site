/**
 * Deal Page Tracker — include on every deal detail page.
 *
 * HOW TO INSTALL
 * --------------
 * 1. Include this script in the page <head> (defer recommended):
 *      <script src="/deal-page-tracker.js" defer></script>
 *
 * 2. Ensure a meta tag with the deal id is present somewhere in the <head>:
 *      <meta name="deal-id" content="PHX-001">
 *
 *    The meta tag can be present at page load (static pages) OR injected
 *    dynamically later (e.g. after a fetch() loads the deal). This script
 *    uses a MutationObserver to handle both cases transparently.
 *
 * WHAT IT DOES
 * ------------
 * Reads:
 *   - ?cid= from the URL (the buyer's GHL contact id, passed in by email links)
 *   - <meta name="deal-id" content="..."> from the page head
 *
 * If BOTH are present, fires a single POST to /api/deal-view-tracker with
 *   { contactId, dealId }
 *
 * If no ?cid= is present, the visitor is anonymous and we can't tag them —
 * the script silently does nothing and never observes.
 *
 * Fires exactly once per page load. No retries. All errors are swallowed and
 * logged to console only — a tracking failure must never break the page.
 *
 * Dependencies: none. Vanilla JS, runs in all modern browsers.
 */
(function () {
  'use strict';

  var fired = false;

  function getDealIdFromMeta() {
    var m = document.querySelector('meta[name="deal-id"]');
    return m ? (m.getAttribute('content') || '').trim() : '';
  }

  function getContactId() {
    try {
      var params = new URLSearchParams(window.location.search);
      return (params.get('cid') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function send(contactId, dealId) {
    if (fired) return;
    fired = true;
    try {
      fetch('/api/deal-view-tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: contactId, dealId: dealId }),
        keepalive: true,
      })
        .then(function (res) {
          if (!res.ok) {
            console.warn('[deal-page-tracker] non-OK response:', res.status);
          } else {
            console.log('[deal-page-tracker] view tracked:', dealId);
          }
        })
        .catch(function (err) {
          console.warn('[deal-page-tracker] fetch failed:', err && err.message);
        });
    } catch (err) {
      console.warn('[deal-page-tracker] error:', err && err.message);
    }
  }

  function attempt(contactId) {
    if (fired) return true;
    var dealId = getDealIdFromMeta();
    if (!dealId) return false;
    send(contactId, dealId);
    return true;
  }

  function start() {
    try {
      var contactId = getContactId();
      if (!contactId) {
        // Anonymous visitor — nothing to tag, nothing to observe.
        return;
      }

      // Try immediately — works for static pages where the meta tag exists at load
      if (attempt(contactId)) return;

      // Dynamic page (deal data loads async, meta tag injected after DOM ready).
      // Watch the document for the meta tag to appear. Give up after 10 seconds
      // to avoid observing forever on pages that never populate it.
      var observer = new MutationObserver(function () {
        if (attempt(contactId)) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(function () {
        if (!fired) observer.disconnect();
      }, 10000);
    } catch (err) {
      console.warn('[deal-page-tracker] start error:', err && err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
