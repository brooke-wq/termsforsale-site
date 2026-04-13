#!/usr/bin/env node
/**
 * Deal Buddy Agent Scheduler — runs on the Paperclip droplet via PM2.
 *
 * Scans the Notion Lindy DB for agents with trigger=schedule and status=active,
 * checks if each agent's schedule is due (based on cron expression + last run),
 * and executes due agents by calling the lindy-run handler directly.
 *
 * Usage:
 *   node deal-buddy-scheduler.js              # run all due agents
 *   node deal-buddy-scheduler.js --list       # list agents and their schedules
 *   node deal-buddy-scheduler.js --agent=slug # run a specific agent by slug
 *   node deal-buddy-scheduler.js --dry-run    # log what would run, don't execute
 *
 * PM2:
 *   Runs every 5 minutes. Agents with schedules like "hourly", "daily 7am",
 *   "every 30m" are checked against their lastRun timestamp.
 *
 * Environment:
 *   NOTION_TOKEN, NOTION_LINDY_DB, ANTHROPIC_API_KEY, GHL_API_KEY, GHL_LOCATION_ID,
 *   ADMIN_PASSWORD (required for the run handler)
 */

var path = require('path');

var FUNCTIONS_DIR = path.join(__dirname, '..', 'termsforsale', 'netlify', 'functions');

// Simple schedule parser — converts human-readable schedules to milliseconds
// Supports: "every 5m", "every 30m", "every 1h", "every 2h", "hourly", "daily", "daily 7am", "daily 9am"
function parseScheduleMs(schedule) {
  if (!schedule) return 0;
  var s = schedule.toLowerCase().trim();

  // "every Xm" or "every X minutes"
  var minMatch = s.match(/every\s+(\d+)\s*m(?:in(?:ute)?s?)?/);
  if (minMatch) return parseInt(minMatch[1]) * 60 * 1000;

  // "every Xh" or "every X hours"
  var hrMatch = s.match(/every\s+(\d+)\s*h(?:ours?)?/);
  if (hrMatch) return parseInt(hrMatch[1]) * 60 * 60 * 1000;

  // Named intervals
  if (s === 'every 5m' || s === '5m') return 5 * 60 * 1000;
  if (s === 'every 15m' || s === '15m') return 15 * 60 * 1000;
  if (s === 'every 30m' || s === '30m') return 30 * 60 * 1000;
  if (s === 'hourly' || s === 'every hour' || s === '1h') return 60 * 60 * 1000;
  if (s === 'daily' || s === 'every day' || s === '24h') return 24 * 60 * 60 * 1000;
  if (s === 'weekly' || s === 'every week') return 7 * 24 * 60 * 60 * 1000;

  // "daily Xam/pm" — runs once per day, but we still use 24h interval
  // The actual time-of-day gating is handled by isDue()
  if (s.match(/daily\s+\d+\s*(am|pm)/)) return 24 * 60 * 60 * 1000;

  console.warn('[deal-buddy] Unknown schedule format: "' + schedule + '", defaulting to 1 hour');
  return 60 * 60 * 1000;
}

// Check if a "daily Xam/pm" agent should run now (within the current hour in AZ time)
function isDailyTimeMatch(schedule) {
  if (!schedule) return true;
  var s = schedule.toLowerCase().trim();
  var match = s.match(/daily\s+(\d+)\s*(am|pm)/);
  if (!match) return true; // not a daily-at-time schedule

  var hour = parseInt(match[1]);
  if (match[2] === 'pm' && hour !== 12) hour += 12;
  if (match[2] === 'am' && hour === 12) hour = 0;

  // Get current hour in Arizona time (America/Phoenix, no DST)
  var now = new Date();
  var azHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Phoenix', hour: 'numeric', hour12: false }));

  return azHour === hour;
}

function isDue(agent) {
  var intervalMs = parseScheduleMs(agent.schedule);
  if (intervalMs === 0) return false;

  // Check daily time-of-day gating
  if (!isDailyTimeMatch(agent.schedule)) return false;

  // Check if enough time has passed since last run
  if (!agent.lastRun) return true; // never run = due
  var lastRunTime = new Date(agent.lastRun).getTime();
  var elapsed = Date.now() - lastRunTime;

  // Allow 2-minute grace period for scheduler timing jitter
  return elapsed >= (intervalMs - 2 * 60 * 1000);
}

async function main() {
  var args = process.argv.slice(2);
  var dryRun = args.indexOf('--dry-run') >= 0;
  var listOnly = args.indexOf('--list') >= 0;
  var specificAgent = null;
  args.forEach(function(a) {
    var m = a.match(/^--agent=(.+)$/);
    if (m) specificAgent = m[1];
  });

  console.log('[deal-buddy] Scheduler starting at ' + new Date().toISOString());

  // Load the lindy module
  var lindy;
  try {
    lindy = require(path.join(FUNCTIONS_DIR, '_lindy'));
  } catch (e) {
    console.error('[deal-buddy] Failed to load _lindy.js:', e.message);
    process.exit(1);
  }

  if (!lindy.lindyDb()) {
    console.error('[deal-buddy] NOTION_LINDY_DB not set');
    process.exit(1);
  }

  // Fetch all agents
  var agents;
  try {
    agents = await lindy.listAgents();
  } catch (e) {
    console.error('[deal-buddy] Failed to list agents:', e.message);
    process.exit(1);
  }

  // Filter to scheduled, active agents
  var scheduled = agents.filter(function(a) {
    return a.trigger === 'schedule' && a.status === 'active' && a.schedule;
  });

  if (listOnly) {
    console.log('[deal-buddy] Scheduled agents: ' + scheduled.length);
    scheduled.forEach(function(a) {
      var due = isDue(a);
      console.log('  ' + a.slug + ' | "' + a.schedule + '" | last run: ' + (a.lastRun || 'never') + ' | due: ' + due);
    });
    process.exit(0);
  }

  // If a specific agent is requested, find it
  if (specificAgent) {
    var found = agents.find(function(a) { return a.slug === specificAgent || a.id === specificAgent; });
    if (!found) {
      console.error('[deal-buddy] Agent not found: ' + specificAgent);
      process.exit(1);
    }
    scheduled = [found];
  }

  // Filter to due agents
  var due = specificAgent ? scheduled : scheduled.filter(isDue);

  console.log('[deal-buddy] ' + scheduled.length + ' scheduled agents, ' + due.length + ' due now');

  if (due.length === 0) {
    console.log('[deal-buddy] Nothing to run');
    process.exit(0);
  }

  // Run due agents sequentially to stay within cost/rate limits
  for (var i = 0; i < due.length; i++) {
    var agent = due[i];
    console.log('[deal-buddy] Running: ' + agent.name + ' (' + agent.slug + ')');

    if (dryRun) {
      console.log('[deal-buddy] DRY RUN — would execute ' + agent.name);
      continue;
    }

    try {
      // Fetch full agent with system prompt
      var fullAgent = await lindy.getAgent(agent.id);

      // The scheduled input is a trigger message
      var input = 'Scheduled run triggered at ' + new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }) + ' (Arizona time). Execute your primary objective.';

      // Create run record
      var run = await lindy.createRun({
        agentId: fullAgent.id,
        agentName: fullAgent.name,
        input: input,
        status: 'running'
      });

      // Execute
      var result = await lindy.runAgent(fullAgent, input);

      // Update run record
      if (run) {
        await lindy.updateRun(run.id, {
          status: 'complete',
          output: result.output,
          duration: result.duration,
          cost: result.cost,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          toolCalls: result.toolCalls
        });
      }

      // Update agent stats
      await lindy.updateAgent(fullAgent.id, {
        runCount: (fullAgent.runCount || 0) + 1,
        totalCost: Math.round(((fullAgent.totalCost || 0) + result.cost) * 1e6) / 1e6,
        lastRun: new Date().toISOString()
      });

      console.log('[deal-buddy] ' + agent.name + ' complete: ' +
        result.toolCalls + ' tool calls, $' + result.cost.toFixed(4) + ', ' +
        (result.duration / 1000).toFixed(1) + 's');

    } catch (e) {
      console.error('[deal-buddy] ' + agent.name + ' FAILED:', e.message);

      // Still update lastRun so we don't retry every 5 minutes on persistent errors
      try {
        await lindy.updateAgent(agent.id, { lastRun: new Date().toISOString() });
      } catch (e2) { /* ignore */ }
    }
  }

  console.log('[deal-buddy] Scheduler complete');
}

main().catch(function(e) {
  console.error('[deal-buddy] Fatal:', e.message);
  process.exit(1);
});
