#!/usr/bin/env node
/**
 * Watchdog — Dead Man's Switch for Paperclip AI OS
 * Runs every 6 hours via cron.
 * Checks /var/log/paperclip.log for recent activity.
 * If no successful job has run in 6+ hours, SMS Brooke.
 *
 * Also checks that the deploy-hook server is responsive.
 */

const fs = require('fs');
const path = require('path');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOG_FILE = '/var/log/paperclip.log';
const MAX_SILENCE_HOURS = 6;

async function main() {
  var ghlKey     = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  var brookePhone = process.env.BROOKE_PHONE;

  if (!ghlKey || !locationId || !brookePhone) {
    console.error('[watchdog] Missing env vars');
    process.exit(1);
  }

  var issues = [];

  // 1. Check log file freshness
  try {
    var stat = fs.statSync(LOG_FILE);
    var hoursSinceModified = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

    if (hoursSinceModified > MAX_SILENCE_HOURS) {
      issues.push('No cron activity in ' + Math.floor(hoursSinceModified) + 'h');
    } else {
      console.log('[watchdog] Log file updated ' + hoursSinceModified.toFixed(1) + 'h ago — OK');
    }
  } catch (e) {
    issues.push('Log file missing or unreadable');
  }

  // 2. Check deploy-hook is running
  try {
    var res = await fetch('http://localhost:9000/health');
    if (res.ok) {
      var data = await res.json();
      console.log('[watchdog] Deploy hook uptime: ' + Math.floor(data.uptime) + 's — OK');
    } else {
      issues.push('Deploy hook returned ' + res.status);
    }
  } catch (e) {
    issues.push('Deploy hook not responding');
  }

  // 3. Check last few log lines for errors
  try {
    var log = fs.readFileSync(LOG_FILE, 'utf8');
    var lines = log.split('\n').filter(Boolean).slice(-50);
    var fatalCount = lines.filter(function(l) {
      return l.includes('Fatal error') || l.includes('ECONNREFUSED') || l.includes('ENOMEM');
    }).length;
    if (fatalCount > 3) {
      issues.push(fatalCount + ' fatal errors in recent logs');
    }
  } catch (e) {
    // Already flagged above
  }

  // Report
  if (issues.length === 0) {
    console.log('[watchdog] All systems OK');
    return;
  }

  console.warn('[watchdog] Issues found:', issues.join('; '));

  // Send alert SMS to Brooke
  var msg = 'PAPERCLIP ALERT: ' + issues.join(' | ');
  if (msg.length > 155) msg = msg.slice(0, 152) + '...';

  // Look up Brooke's contact
  var searchRes = await fetch(GHL_BASE + '/contacts/?locationId=' + locationId + '&query=' + encodeURIComponent(brookePhone) + '&limit=5', {
    headers: {
      'Authorization': 'Bearer ' + ghlKey,
      'Version': '2021-07-28'
    }
  });
  var searchData = await searchRes.json();
  var contacts = (searchData && searchData.contacts) || [];
  var contactId = contacts.length ? contacts[0].id : null;

  if (contactId) {
    await fetch(GHL_BASE + '/conversations/messages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ghlKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'SMS',
        contactId: contactId,
        message: msg
      })
    });
    console.log('[watchdog] Alert SMS sent to Brooke');
  } else {
    console.error('[watchdog] Could not find Brooke contact to send alert');
  }
}

main().catch(function(err) {
  console.error('[watchdog] Fatal:', err.message);
  process.exit(1);
});
