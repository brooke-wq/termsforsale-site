// Lindy AI — Public Webhook Trigger
// Endpoint:
//   POST /api/lindy-webhook?agent=<slug>
//
// Public endpoint — no admin password required.
// Validates that the agent exists, is active, and has trigger=webhook.
// Passes the webhook body as agent input.
// Returns the agent output as JSON.

var lindy = require('./_lindy');

var headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  var qs = event.queryStringParameters || {};
  var slug = qs.agent || '';

  if (!slug) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Missing ?agent=<slug> parameter' }) };
  }

  try {
    // Look up agent by slug
    var agents = await lindy.listAgents();
    var agent = agents.find(function(a) { return a.slug === slug; });

    if (!agent) {
      return { statusCode: 404, headers: headers, body: JSON.stringify({ error: 'Agent not found: ' + slug }) };
    }

    if (agent.status !== 'active') {
      return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Agent is not active' }) };
    }

    if (agent.trigger !== 'webhook') {
      return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Agent trigger is not set to webhook' }) };
    }

    // Fetch full agent with system prompt
    agent = await lindy.getAgent(agent.id);

    // Build input from webhook body
    var rawBody = event.body || '{}';
    var input;
    try {
      var parsed = JSON.parse(rawBody);
      // If the body has an "input" field, use that; otherwise stringify the whole body
      input = parsed.input || JSON.stringify(parsed, null, 2);
    } catch (e) {
      input = rawBody;
    }

    // Create run record
    var run = await lindy.createRun({
      agentId: agent.id,
      agentName: agent.name,
      input: input,
      status: 'running'
    });

    // Execute
    var result = await lindy.runAgent(agent, input);

    // Update run
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
    try {
      await lindy.updateAgent(agent.id, {
        runCount: (agent.runCount || 0) + 1,
        totalCost: Math.round(((agent.totalCost || 0) + result.cost) * 1e6) / 1e6,
        lastRun: new Date().toISOString()
      });
    } catch (e) {
      console.error('[lindy-webhook] Failed to update agent stats:', e.message);
    }

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        agent: agent.name,
        output: result.output,
        toolCalls: result.toolCalls,
        duration: result.duration,
        cost: result.cost
      })
    };

  } catch (err) {
    console.error('[lindy-webhook] Error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
