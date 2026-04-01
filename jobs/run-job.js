#!/usr/bin/env node
/**
 * Universal job runner for Deal Pros Paperclip AI OS.
 *
 * Wraps any Netlify function as a standalone cron job.
 * Called by PM2 with the function name as the first argument.
 *
 * Usage:
 *   node run-job.js underwriting-poller
 *   node run-job.js ceo-briefing
 *   node run-job.js lead-intake
 *
 * For "poller" jobs (underwriting-poller, deal-package-poller, deal-dog-poller):
 *   Calls the handler directly — these already scan GHL for tagged contacts.
 *
 * For "trigger" jobs (lead-intake, seller-call-prep, buyer-relations, etc.):
 *   Scans GHL for contacts with the appropriate trigger tag,
 *   then calls the function's handler with each contact.
 *
 * For "scheduled" jobs (ceo-briefing, weekly-synthesis, notify-buyers):
 *   Calls the handler directly — these are self-contained.
 */

const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', 'termsforsale', 'netlify', 'functions');

// Map job names to their trigger tags and function files
const JOB_CONFIG = {
  'underwriting-poller':    { type: 'self-contained', file: 'underwriting-poller' },
  'deal-package-poller':    { type: 'self-contained', file: 'deal-package-poller' },
  'deal-dog-poller':        { type: 'self-contained', file: 'deal-dog-poller' },
  'notify-buyers':          { type: 'self-contained', file: 'notify-buyers' },
  'ceo-briefing':           { type: 'self-contained', file: 'ceo-briefing' },
  'weekly-synthesis':       { type: 'self-contained', file: 'weekly-synthesis' },
  'lead-intake':            { type: 'tag-scan', file: 'lead-intake', tag: 'lead-new', locationEnv: 'GHL_LOCATION_ID_ACQASSIST' },
  'seller-call-prep':       { type: 'tag-scan', file: 'seller-call-prep', tag: 'uw-complete', locationEnv: 'GHL_LOCATION_ID_ACQASSIST' },
  'buyer-relations':        { type: 'tag-scan', file: 'buyer-relations', tag: 'buyer-signup', locationEnv: 'GHL_LOCATION_ID' },
  'dispo-buddy-triage':     { type: 'tag-scan', file: 'dispo-buddy-triage', tag: 'jv-submitted', locationEnv: 'GHL_LOCATION_ID_DISPO' },
  'equity-exit-intake':     { type: 'tag-scan', file: 'equity-exit-intake', tag: 'equity-exit-inquiry', locationEnv: 'GHL_LOCATION_ID' },
};

const GHL_BASE = 'https://services.leadconnectorhq.com';

async function main() {
  const jobName = process.argv[2];

  if (!jobName || !JOB_CONFIG[jobName]) {
    console.error('Usage: node run-job.js <job-name>');
    console.error('Available jobs:', Object.keys(JOB_CONFIG).join(', '));
    process.exit(1);
  }

  const config = JOB_CONFIG[jobName];
  const startTime = Date.now();
  console.log(`[${jobName}] Starting at ${new Date().toISOString()}`);

  try {
    const fn = require(path.join(FUNCTIONS_DIR, config.file));

    if (config.type === 'self-contained') {
      // These functions handle their own scanning — just call the handler
      const event = { httpMethod: 'POST', body: '{}', queryStringParameters: {} };
      const result = await fn.handler(event);
      console.log(`[${jobName}] Completed with status ${result.statusCode}`);
    } else if (config.type === 'tag-scan') {
      // Scan for tagged contacts, call the function for each
      const ghlKey = process.env.GHL_API_KEY;
      const locationId = process.env[config.locationEnv] || process.env.GHL_LOCATION_ID;

      if (!ghlKey || !locationId) {
        console.error(`[${jobName}] Missing GHL_API_KEY or ${config.locationEnv}`);
        process.exit(1);
      }

      const contacts = await findTaggedContacts(ghlKey, locationId, config.tag);

      if (!contacts.length) {
        console.log(`[${jobName}] No contacts tagged "${config.tag}" — done.`);
      } else {
        console.log(`[${jobName}] Found ${contacts.length} contact(s) tagged "${config.tag}"`);

        for (const contact of contacts) {
          try {
            const event = {
              httpMethod: 'POST',
              body: JSON.stringify({ contact_id: contact.id, contactId: contact.id }),
            };
            const result = await fn.handler(event);
            console.log(`[${jobName}] Contact ${contact.id}: status ${result.statusCode}`);
          } catch (err) {
            console.error(`[${jobName}] Error on contact ${contact.id}:`, err.message);
          }
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${jobName}] Finished in ${elapsed}s`);

  } catch (err) {
    console.error(`[${jobName}] Fatal error:`, err.message);
    process.exit(1);
  }
}

// ─── GHL tag search (same logic as pollers) ───────────────────

async function findTaggedContacts(apiKey, locationId, tag) {
  const contacts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`${GHL_BASE}/contacts/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({
        locationId,
        page,
        pageLimit: 100,
        filters: [{
          group: 'AND',
          filters: [{
            field: 'tags',
            operator: 'contains',
            value: [tag],
          }],
        }],
      }),
    });

    if (!res.ok) {
      console.warn(`[run-job] Search failed (${res.status}) — falling back to list scan`);
      return findTaggedContactsFallback(apiKey, locationId, tag);
    }

    const data = await res.json();
    const batch = data.contacts || data.data || [];
    contacts.push(...batch);

    const meta = data.meta || {};
    const total = meta.total || batch.length;
    if (contacts.length >= total || !batch.length) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return contacts;
}

async function findTaggedContactsFallback(apiKey, locationId, tag) {
  const tagged = [];
  let startAfter = '';
  let startAfterId = '';
  let checked = 0;

  while (true) {
    let url = `${GHL_BASE}/contacts/?locationId=${locationId}&limit=100`;
    if (startAfter) url += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
      },
    });

    if (!res.ok) break;
    const data = await res.json();
    const batch = data.contacts || [];
    checked += batch.length;

    batch.forEach(contact => {
      if ((contact.tags || []).includes(tag)) tagged.push(contact);
    });

    if (!batch.length || checked >= 3000) break;
    const meta = data.meta || {};
    if (!meta.nextPageUrl) break;
    const last = batch[batch.length - 1];
    startAfter = last.startAfter?.[0] || '';
    startAfterId = last.startAfter?.[1] || last.id;
    if (!startAfter) break;
  }

  console.log(`[run-job] Fallback: checked ${checked}, found ${tagged.length} tagged "${tag}"`);
  return tagged;
}

main();
