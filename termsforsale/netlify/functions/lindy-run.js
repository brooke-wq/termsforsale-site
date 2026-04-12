// Lindy AI — Agent Execution + Run History
// Endpoints:
//   POST /api/lindy-run                → run an agent (body: { agentId, input })
//   GET  /api/lindy-run                → list recent runs
//   GET  /api/lindy-run?agentId=xxx    → list runs for a specific agent
//   GET  /api/lindy-run?id=xxx         → get single run details
//
// All endpoints require X-Admin-Password header (except OPTIONS).

var lindy = require('./_lindy');

var headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if (!lindy.verifyAdmin(event)) {
    return { statusCode: 401, headers: headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  var qs = event.queryStringParameters || {};

  try {
    // ── GET — Run history ──
    if (event.httpMethod === 'GET') {
      var runs = await lindy.listRuns({
        agentId: qs.agentId || null,
        limit: parseInt(qs.limit) || 50
      });
      return { statusCode: 200, headers: headers, body: JSON.stringify({ runs: runs }) };
    }

    // ── POST — Execute agent ──
    if (event.httpMethod === 'POST') {
      var body = JSON.parse(event.body || '{}');

      if (!body.agentId) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'agentId is required' }) };
      }
      if (!body.input || !body.input.trim()) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'input is required' }) };
      }

      // Fetch agent config
      var agent = await lindy.getAgent(body.agentId);
      if (!agent || agent.type !== 'agent') {
        return { statusCode: 404, headers: headers, body: JSON.stringify({ error: 'Agent not found' }) };
      }
      if (agent.status === 'paused') {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Agent is paused' }) };
      }

      // Create run record
      var run = await lindy.createRun({
        agentId: agent.id,
        agentName: agent.name,
        input: body.input,
        status: 'running'
      });

      // Execute agent
      var result;
      var runStatus = 'complete';
      var error = '';

      try {
        result = await lindy.runAgent(agent, body.input);
      } catch (err) {
        console.error('[lindy-run] Execution error:', err.message);
        runStatus = 'failed';
        error = err.message;
        result = {
          output: '',
          duration: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          toolCalls: 0,
          toolsUsed: [],
          rounds: 0
        };
      }

      // Update run record
      if (run) {
        await lindy.updateRun(run.id, {
          status: runStatus,
          output: result.output,
          duration: result.duration,
          cost: result.cost,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          toolCalls: result.toolCalls,
          error: error
        });
      }

      // Update agent stats
      try {
        await lindy.updateAgent(agent.id, {
          runCount: (agent.runCount || 0) + 1,
          totalCost: Math.round(((agent.totalCost || 0) + result.cost) * 1e6) / 1e6,
          lastRun: new Date().toISOString()
        });
      } catch (e) {
        console.error('[lindy-run] Failed to update agent stats:', e.message);
      }

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({
          runId: run ? run.id : null,
          status: runStatus,
          output: result.output,
          duration: result.duration,
          cost: result.cost,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          toolCalls: result.toolCalls,
          toolsUsed: result.toolsUsed,
          rounds: result.rounds,
          error: error || undefined
        })
      };
    }

    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('[lindy-run] Error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
