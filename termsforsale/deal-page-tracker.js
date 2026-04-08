/**
 * Deal Page Tracker — include on every deal detail page.
 *
 * HOW TO INSTALL
 * --------------
 * 1. Add a <meta> tag in the page <head> declaring the deal id:
 *      <meta name="deal-id" content="PHX-001">
 *
 * 2. Include this script anywhere in the page (defer recommended):
 *      <script src="/deal-page-tracker.js" defer></script>
 *
 * WHAT IT DOES
 * ------------
 * On DOMContentLoaded it reads:
 *   - ?cid= from the URL (the buyer's GHL contact id, passed in by email links)
 *   - the "deal-id" meta tag from the page head
 *
 * If BOTH are present, it fires a single POST to /api/deal-view-tracker with
 *   { contactId, dealId }
 *
 * If no ?cid= is present, the visitor is anonymous and we can't tag them —
 * the script silently does nothing.
 *
 * Fires exactly once per page load. No retries. All errors are swallowed and
 * logged to console only — a tracking failure must never break the page.
 *
 * Dependencies: none. Vanilla JS, runs in all modern browsers.
 */
(function () {
  'use strict';

  function track() {
    try {
      // 1. Read ?cid= from the URL
      var params = new URLSearchParams(window.location.search);
      var contactId = (params.get('cid') || '').trim();
      if (!contactId) {
        // Anonymous visitor — nothing to tag, exit silently.
        return;
      }

      // 2. Read deal id from <meta name="deal-id" content="PHX-001">
      var metaEl = document.querySelector('meta[name="deal-id"]');
      var dealId = metaEl ? (metaEl.getAttribute('content') || '').trim() : '';
      if (!dealId) {
        console.warn('[deal-page-tracker] no <meta name="deal-id"> found — skipping');
        return;
      }

      // 3. Fire POST — fire-and-forget, silent fail
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
      // Defensive catch — tracking must never break the page.
      console.warn('[deal-page-tracker] error:', err && err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', track);
  } else {
    // Document already parsed (e.g. defer/async loaded after DOM ready)
    track();
  }
})();
