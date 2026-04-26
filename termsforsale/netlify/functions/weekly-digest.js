/**
 * Weekly Team Digest — Terms For Sale
 *
 * Compiles updates from CLAUDE.md + git + Notion + GHL into a single
 * operational recap, then ships it to:
 *   1. Email (via GHL conversations API → BROOKE_CONTACT_ID)
 *   2. Slack #announcements (via SLACK_WEBHOOK_URL incoming webhook)
 *   3. Notion "Track Changes Updates" page (appends as a new section)
 *
 * Triggered by:
 *   - Paperclip cron Mondays 7am AZ (jobs/weekly-digest-cron.js)
 *   - Manual GET /api/weekly-digest?test=true (preview, no sends)
 *   - Manual POST /api/weekly-digest (live send, requires DIGEST_LIVE=true)
 *
 * Cost: ~$0.001 per run (one Claude Haiku call for the TL;DR).
 * Total: ~$0.05/year. Negligible.
 *
 * ENV VARS:
 *   ANTHROPIC_API_KEY    — required for the TL;DR synthesis
 *   NOTION_TOKEN         — required for deal stats + Notion log append
 *   NOTION_DB_ID         — deals DB (defaults to a3c0a3...)
 *   NOTION_DIGEST_PAGE_ID — "Track Changes Updates" page (set this!)
 *   GHL_API_KEY          — required for engagement stats + email send
 *   GHL_LOCATION_ID      — defaults to 7IyUgu1zpi38MDYpSDTs (TFS)
 *   BROOKE_CONTACT_ID    — defaults to 1HMBtAv9EuTlJa5EekAL
 *   DIGEST_RECIPIENTS    — comma-separated GHL contact IDs (overrides BROOKE_CONTACT_ID)
 *   SLACK_WEBHOOK_URL    — Slack incoming webhook for #announcements
 *   DIGEST_LIVE          — "true" to actually send. Default: preview-only.
 */

const { gatherWeeklyData } = require('./_digest');
const { complete } = require('./_claude');
const { sendEmail } = require('./_ghl');

// File-based dedup (Droplet only)
let sentLog;
try { sentLog = require('../../../jobs/sent-log'); } catch (e) { sentLog = null; }

const NOTION_VERSION = '2022-06-28';
const NOTION_DIGEST_PAGE_DEFAULT = 'c18090d675e783b187af8182ecf57920'; // "Track Changes Updates"

// ─── Helpers ─────────────────────────────────────────────────────

function fmtMoney(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function safe(s) {
  return String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// Categorize a commit subject by impact area for cleaner display
function categorizeCommit(subject) {
  const s = (subject || '').toLowerCase();
  if (/\b(fix|hotfix|bug|broken|crash|regression|404|500)\b/.test(s)) return 'fixes';
  if (/\b(add|new|launch|ship|introduce|build|create)\b/.test(s)) return 'features';
  if (/\b(update|tweak|refine|adjust|tune|polish|improve)\b/.test(s)) return 'improvements';
  if (/\b(doc|readme|claude\.md|comment)\b/.test(s)) return 'docs';
  return 'other';
}

// ─── Claude Haiku TL;DR generator ────────────────────────────────

async function generateTldr(anthropicKey, data) {
  if (!anthropicKey) {
    return 'Weekly recap below — see "What we shipped" for details. (TL;DR generation skipped: ANTHROPIC_API_KEY not set.)';
  }

  // Build a compact context for Claude — just titles + short summaries
  const completedTitles = (data.completed || []).slice(0, 8)
    .map(c => `- ${c.dateISO}: ${c.title.slice(0, 120)}`)
    .join('\n') || '(none)';

  const commitCount = (data.commits || []).length;
  const notion = data.notion || {};
  const ghl = data.ghl || {};

  const prompt = `You are writing a 2-3 sentence TL;DR for a weekly team digest at Terms For Sale, a real estate wholesale company. The team is operational (not technical). Be direct, plain-language, and concrete. No filler, no "I'm pleased to report", no emojis. Lead with the most newsworthy item.

WEEK: ${data.window.label}

WHAT SHIPPED (top items):
${completedTitles}

COMMITS: ${commitCount} this week
ACTIVE DEALS: ${notion.activeMarketing || 0}
DEALS FUNDED THIS WEEK: ${(notion.fundedThisWeek || []).length} (${fmtMoney(notion.totalFundedThisWeek || 0)})
NEW DEALS LISTED: ${(notion.newDealsThisWeek || []).length}
TOTAL OPTED-IN BUYERS: ${ghl.buyersTotal || 0}

Write the TL;DR now. 2-3 sentences max.`;

  try {
    const res = await complete(anthropicKey, {
      system: 'You write concise, plain-language summaries for ops teams. No fluff.',
      user: prompt,
      maxTokens: 200,
      model: 'claude-haiku-4-5-20251001'
    });
    return (res.text || '').trim() || 'Weekly recap below.';
  } catch (err) {
    console.warn('[weekly-digest] Claude TL;DR failed:', err.message);
    return 'Weekly recap below — see "What we shipped" for details.';
  }
}

// ─── Format builders ─────────────────────────────────────────────

function buildEmailHtml(data, tldr) {
  const completed = data.completed || [];
  const commits = data.commits || [];
  const notion = data.notion || {};
  const ghl = data.ghl || {};

  // Categorize commits
  const buckets = { fixes: [], features: [], improvements: [], docs: [], other: [] };
  for (const c of commits) {
    buckets[categorizeCommit(c.subject)].push(c);
  }

  // Build "What we shipped" section from CLAUDE.md
  const shippedHtml = completed.length
    ? completed.slice(0, 10).map(c => `
        <div style="margin-bottom:16px;padding:12px 14px;background:#f8fafc;border-left:3px solid #0D1F3C;border-radius:4px;">
          <div style="font-size:13px;color:#64748b;margin-bottom:4px;">${safe(c.dateISO)}</div>
          <div style="font-weight:600;color:#0D1F3C;">${safe(c.title)}</div>
        </div>`).join('')
    : '<p style="color:#64748b;font-style:italic;">No major shipments logged this week.</p>';

  // Build commit summary
  const commitListHtml = (() => {
    const parts = [];
    if (buckets.fixes.length) {
      parts.push(`<p style="margin:8px 0;"><strong style="color:#dc2626;">🔧 Fixes (${buckets.fixes.length}):</strong></p><ul style="margin:0 0 12px 18px;color:#334155;">${buckets.fixes.slice(0, 8).map(c => `<li>${safe(c.subject)}</li>`).join('')}</ul>`);
    }
    if (buckets.features.length) {
      parts.push(`<p style="margin:8px 0;"><strong style="color:#16a34a;">🚀 New (${buckets.features.length}):</strong></p><ul style="margin:0 0 12px 18px;color:#334155;">${buckets.features.slice(0, 8).map(c => `<li>${safe(c.subject)}</li>`).join('')}</ul>`);
    }
    if (buckets.improvements.length) {
      parts.push(`<p style="margin:8px 0;"><strong style="color:#2563eb;">✨ Improvements (${buckets.improvements.length}):</strong></p><ul style="margin:0 0 12px 18px;color:#334155;">${buckets.improvements.slice(0, 6).map(c => `<li>${safe(c.subject)}</li>`).join('')}</ul>`);
    }
    if (!parts.length) return '<p style="color:#64748b;font-style:italic;">No commits this week.</p>';
    return parts.join('');
  })();

  // Business numbers tile row
  const numbersHtml = `
    <table style="width:100%;border-collapse:collapse;margin:12px 0;">
      <tr>
        <td style="padding:12px;background:#0D1F3C;color:white;border-radius:6px;text-align:center;width:25%;">
          <div style="font-size:24px;font-weight:700;">${notion.activeMarketing || 0}</div>
          <div style="font-size:11px;opacity:0.85;text-transform:uppercase;letter-spacing:0.5px;">Active Deals</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:12px;background:#16a34a;color:white;border-radius:6px;text-align:center;width:25%;">
          <div style="font-size:24px;font-weight:700;">${(notion.fundedThisWeek || []).length}</div>
          <div style="font-size:11px;opacity:0.85;text-transform:uppercase;letter-spacing:0.5px;">Funded This Wk</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:12px;background:#F7941D;color:white;border-radius:6px;text-align:center;width:25%;">
          <div style="font-size:18px;font-weight:700;">${fmtMoney(notion.totalFundedThisWeek || 0)}</div>
          <div style="font-size:11px;opacity:0.85;text-transform:uppercase;letter-spacing:0.5px;">Assignment $</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:12px;background:#29ABE2;color:white;border-radius:6px;text-align:center;width:25%;">
          <div style="font-size:24px;font-weight:700;">${(notion.newDealsThisWeek || []).length}</div>
          <div style="font-size:11px;opacity:0.85;text-transform:uppercase;letter-spacing:0.5px;">New Listings</div>
        </td>
      </tr>
    </table>`;

  // Funnel stats
  const funnelHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 8px;color:#64748b;">Total opted-in buyers</td><td style="padding:6px 8px;text-align:right;font-weight:600;">${(ghl.buyersTotal || 0).toLocaleString()}</td></tr>
      <tr><td style="padding:6px 8px;color:#64748b;">Lifetime deal alerts sent</td><td style="padding:6px 8px;text-align:right;font-weight:600;">${(ghl.newDealAlerts || 0).toLocaleString()}</td></tr>
      <tr><td style="padding:6px 8px;color:#64748b;">Active viewers (clicked a deal)</td><td style="padding:6px 8px;text-align:right;font-weight:600;">${(ghl.activeViewers || 0).toLocaleString()}</td></tr>
      <tr><td style="padding:6px 8px;color:#64748b;">Replied INTERESTED</td><td style="padding:6px 8px;text-align:right;font-weight:600;color:#16a34a;">${(ghl.buyerInterested || 0).toLocaleString()}</td></tr>
      <tr><td style="padding:6px 8px;color:#64748b;">Replied PASS</td><td style="padding:6px 8px;text-align:right;font-weight:600;color:#dc2626;">${(ghl.buyerPass || 0).toLocaleString()}</td></tr>
      <tr><td style="padding:6px 8px;color:#64748b;">Alerts paused</td><td style="padding:6px 8px;text-align:right;font-weight:600;">${(ghl.alertsPaused || 0).toLocaleString()}</td></tr>
    </table>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table style="width:100%;background:#f1f5f9;padding:24px 0;"><tr><td align="center">
    <table style="max-width:680px;width:100%;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:linear-gradient(135deg,#0D1F3C 0%,#1e3a5f 100%);padding:28px 32px;color:white;">
        <div style="font-size:13px;opacity:0.8;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Weekly Team Digest</div>
        <div style="font-size:24px;font-weight:700;">Terms For Sale — ${safe(data.window.label)}</div>
      </td></tr>
      <tr><td style="padding:24px 32px;">
        <div style="background:#fef3c7;border-left:4px solid #F7941D;padding:14px 16px;border-radius:4px;margin-bottom:24px;">
          <div style="font-size:11px;font-weight:700;color:#92400e;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">TL;DR</div>
          <div style="color:#0D1F3C;line-height:1.5;">${safe(tldr)}</div>
        </div>

        <h2 style="font-size:14px;font-weight:700;color:#0D1F3C;text-transform:uppercase;letter-spacing:1px;margin:24px 0 8px;">📊 The Numbers</h2>
        ${numbersHtml}

        <h2 style="font-size:14px;font-weight:700;color:#0D1F3C;text-transform:uppercase;letter-spacing:1px;margin:24px 0 12px;">🛠️ What We Shipped</h2>
        ${shippedHtml}

        <h2 style="font-size:14px;font-weight:700;color:#0D1F3C;text-transform:uppercase;letter-spacing:1px;margin:24px 0 12px;">📦 Code Changes (${commits.length})</h2>
        ${commitListHtml}

        <h2 style="font-size:14px;font-weight:700;color:#0D1F3C;text-transform:uppercase;letter-spacing:1px;margin:24px 0 12px;">📡 Buyer Funnel (Lifetime)</h2>
        ${funnelHtml}
        <p style="font-size:12px;color:#94a3b8;font-style:italic;margin-top:8px;">Counts are cumulative. Week-over-week deltas coming in v2.</p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
        Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })} AZ · Terms For Sale Operations
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function buildSlackBlocks(data, tldr) {
  const completed = data.completed || [];
  const commits = data.commits || [];
  const notion = data.notion || {};

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📅 Weekly Digest — ${data.window.label}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*TL;DR*\n${tldr}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Active deals*\n${notion.activeMarketing || 0}` },
        { type: 'mrkdwn', text: `*Funded this week*\n${(notion.fundedThisWeek || []).length}` },
        { type: 'mrkdwn', text: `*Assignment $*\n${fmtMoney(notion.totalFundedThisWeek || 0)}` },
        { type: 'mrkdwn', text: `*New listings*\n${(notion.newDealsThisWeek || []).length}` }
      ]
    }
  ];

  if (completed.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🛠️ What we shipped this week:*\n' +
          completed.slice(0, 8).map(c => `• *${c.dateISO}* — ${c.title}`).join('\n')
      }
    });
  }

  if (commits.length) {
    const buckets = { fixes: [], features: [], improvements: [], other: [] };
    for (const c of commits) {
      const cat = categorizeCommit(c.subject);
      (buckets[cat] || buckets.other).push(c);
    }
    const summary = [
      buckets.fixes.length && `🔧 ${buckets.fixes.length} fixes`,
      buckets.features.length && `🚀 ${buckets.features.length} new features`,
      buckets.improvements.length && `✨ ${buckets.improvements.length} improvements`
    ].filter(Boolean).join(' · ');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*📦 Code activity:* ${commits.length} commits — ${summary || 'mostly housekeeping'}` }
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `_Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })} AZ_` }]
  });

  return blocks;
}

function buildNotionBlocks(data, tldr) {
  const completed = data.completed || [];
  const commits = data.commits || [];
  const notion = data.notion || {};
  const ghl = data.ghl || {};

  const txt = (s) => ({ rich_text: [{ type: 'text', text: { content: String(s).slice(0, 1900) } }] });
  const bullet = (s) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: txt(s) });
  const para = (s) => ({ object: 'block', type: 'paragraph', paragraph: txt(s) });
  const h2 = (s) => ({ object: 'block', type: 'heading_2', heading_2: txt(s) });
  const h3 = (s) => ({ object: 'block', type: 'heading_3', heading_3: txt(s) });

  const blocks = [
    h2(`📅 Weekly Digest — ${data.window.label}`),
    {
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: 'TL;DR: ' + tldr } }],
        icon: { type: 'emoji', emoji: '📌' },
        color: 'orange_background'
      }
    },
    h3('📊 The Numbers'),
    bullet(`${notion.activeMarketing || 0} active deals`),
    bullet(`${(notion.fundedThisWeek || []).length} deals funded this week (${fmtMoney(notion.totalFundedThisWeek || 0)} in assignment fees)`),
    bullet(`${(notion.newDealsThisWeek || []).length} new deals listed this week`),
    bullet(`${(ghl.buyersTotal || 0).toLocaleString()} total opted-in buyers`)
  ];

  if (completed.length) {
    blocks.push(h3('🛠️ What We Shipped'));
    completed.slice(0, 12).forEach(c => {
      blocks.push(bullet(`${c.dateISO}: ${c.title}`));
    });
  }

  if (commits.length) {
    const buckets = { fixes: [], features: [], improvements: [], docs: [], other: [] };
    for (const c of commits) buckets[categorizeCommit(c.subject)].push(c);

    blocks.push(h3(`📦 Code Changes (${commits.length} commits)`));
    if (buckets.fixes.length) {
      blocks.push(para(`Fixes (${buckets.fixes.length}):`));
      buckets.fixes.slice(0, 6).forEach(c => blocks.push(bullet(c.subject)));
    }
    if (buckets.features.length) {
      blocks.push(para(`New (${buckets.features.length}):`));
      buckets.features.slice(0, 6).forEach(c => blocks.push(bullet(c.subject)));
    }
    if (buckets.improvements.length) {
      blocks.push(para(`Improvements (${buckets.improvements.length}):`));
      buckets.improvements.slice(0, 6).forEach(c => blocks.push(bullet(c.subject)));
    }
  }

  blocks.push({ object: 'block', type: 'divider', divider: {} });
  blocks.push(para(`Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })} AZ`));

  return blocks;
}

// ─── Delivery functions ──────────────────────────────────────────

async function sendToEmail(ghlKey, recipients, subject, html) {
  if (!ghlKey) return { sent: 0, errors: ['GHL_API_KEY missing'] };
  const errors = [];
  let sent = 0;
  for (const contactId of recipients) {
    try {
      const r = await sendEmail(ghlKey, contactId, subject, html);
      if (r.status >= 200 && r.status < 300) sent++;
      else errors.push(`contact ${contactId}: status ${r.status}`);
    } catch (err) {
      errors.push(`contact ${contactId}: ${err.message}`);
    }
  }
  return { sent, errors };
}

async function sendToSlack(webhookUrl, blocks, fallbackText) {
  if (!webhookUrl) return { ok: false, error: 'SLACK_WEBHOOK_URL not set' };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fallbackText, blocks })
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Slack ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function appendToNotion(token, pageId, blocks) {
  if (!token || !pageId) return { ok: false, error: 'Notion token or page ID missing' };
  try {
    // Notion API caps at 100 blocks per request; chunk if needed
    const chunks = [];
    for (let i = 0; i < blocks.length; i += 100) chunks.push(blocks.slice(i, i + 100));

    for (const chunk of chunks) {
      const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ children: chunk })
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `Notion ${res.status}: ${body.slice(0, 300)}` };
      }
    }
    return { ok: true, blocks: blocks.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Handler ─────────────────────────────────────────────────────

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const qs = event.queryStringParameters || {};
  const isPreview = qs.test === 'true' || qs.preview === 'true';
  const isLiveEnv = process.env.DIGEST_LIVE === 'true';
  const willSend = isLiveEnv && !isPreview;

  console.log(`[weekly-digest] start. preview=${isPreview} liveEnv=${isLiveEnv} willSend=${willSend}`);

  try {
    // 1. Gather data
    const data = await gatherWeeklyData({ days: 7 });
    console.log(`[weekly-digest] gathered: ${data.completed.length} completed, ${data.commits.length} commits, ${data.errors.length} errors`);

    // 2. Generate TL;DR
    const tldr = await generateTldr(process.env.ANTHROPIC_API_KEY, data);

    // 3. Build deliverables
    const subject = `Terms For Sale — Weekly Digest, ${data.window.label}`;
    const emailHtml = buildEmailHtml(data, tldr);
    const slackBlocks = buildSlackBlocks(data, tldr);
    const notionBlocks = buildNotionBlocks(data, tldr);

    if (!willSend) {
      // Preview mode — return everything without sending
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          mode: 'preview',
          message: 'Preview only. Set DIGEST_LIVE=true and POST without ?test=true to actually send.',
          window: data.window,
          tldr,
          subject,
          stats: {
            completedCount: data.completed.length,
            commitsCount: data.commits.length,
            activeDeals: (data.notion && data.notion.activeMarketing) || 0,
            fundedThisWeek: (data.notion && data.notion.fundedThisWeek || []).length,
            buyersTotal: (data.ghl && data.ghl.buyersTotal) || 0
          },
          gatherErrors: data.errors,
          emailHtmlPreview: emailHtml.slice(0, 600) + '...',
          slackBlocksCount: slackBlocks.length,
          notionBlocksCount: notionBlocks.length
        }, null, 2)
      };
    }

    // Live mode — dedup + send
    const dedupKey = 'digest-' + data.window.since;
    if (sentLog && sentLog.isDroplet() && sentLog.wasSent('team', 'weekly-digest', dedupKey)) {
      console.log(`[weekly-digest] already sent for week ${data.window.since}, skipping`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ mode: 'skipped', reason: 'already sent this week', dedupKey })
      };
    }

    // Resolve recipients
    const recipientsRaw = process.env.DIGEST_RECIPIENTS || process.env.BROOKE_CONTACT_ID || '1HMBtAv9EuTlJa5EekAL';
    const recipients = recipientsRaw.split(',').map(s => s.trim()).filter(Boolean);

    const [emailResult, slackResult, notionResult] = await Promise.all([
      sendToEmail(process.env.GHL_API_KEY, recipients, subject, emailHtml),
      sendToSlack(process.env.SLACK_WEBHOOK_URL, slackBlocks, subject),
      appendToNotion(
        process.env.NOTION_TOKEN,
        process.env.NOTION_DIGEST_PAGE_ID || NOTION_DIGEST_PAGE_DEFAULT,
        notionBlocks
      )
    ]);

    if (sentLog && sentLog.isDroplet()) {
      sentLog.markSent('team', 'weekly-digest', dedupKey);
    }

    console.log(`[weekly-digest] email=${emailResult.sent}/${recipients.length} slack=${slackResult.ok} notion=${notionResult.ok}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        mode: 'sent',
        window: data.window,
        email: emailResult,
        slack: slackResult,
        notion: notionResult,
        gatherErrors: data.errors
      }, null, 2)
    };

  } catch (err) {
    console.error('[weekly-digest] error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, stack: err.stack })
    };
  }
};
