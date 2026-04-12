// Lindy AI — Agent CRUD + Database Setup
// Endpoints:
//   GET  /api/lindy-agents              → list all agents
//   GET  /api/lindy-agents?id=xxx       → get single agent
//   GET  /api/lindy-agents?action=setup-check → check if DB is configured
//   POST /api/lindy-agents              → create agent  (body: { name, description, systemPrompt, tools, trigger, model, maxTokens })
//   POST /api/lindy-agents?action=setup → create Notion database (body: { parentPageId? })
//   PUT  /api/lindy-agents              → update agent  (body: { id, ...fields })
//   DELETE /api/lindy-agents?id=xxx     → archive agent
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
    // ── GET ──
    if (event.httpMethod === 'GET') {
      // Setup check
      if (qs.action === 'setup-check') {
        var dbId = lindy.lindyDb();
        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify({
            configured: !!dbId,
            databaseId: dbId || null,
            tools: Object.keys(lindy.TOOL_CATALOG)
          })
        };
      }

      // Single agent
      if (qs.id) {
        var agent = await lindy.getAgent(qs.id);
        return { statusCode: 200, headers: headers, body: JSON.stringify(agent) };
      }

      // List all agents
      var agents = await lindy.listAgents();
      return { statusCode: 200, headers: headers, body: JSON.stringify({ agents: agents }) };
    }

    // ── POST ──
    if (event.httpMethod === 'POST') {
      var body = JSON.parse(event.body || '{}');

      // Database setup
      if (qs.action === 'setup') {
        var result = await lindy.setupDatabase(body.parentPageId);
        return { statusCode: 200, headers: headers, body: JSON.stringify(result) };
      }

      // Create agent
      if (!body.name) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Agent name is required' }) };
      }
      var agent = await lindy.createAgent({
        name: body.name,
        description: body.description || '',
        systemPrompt: body.systemPrompt || '',
        slug: body.slug || '',
        tools: body.tools || [],
        trigger: body.trigger || 'manual',
        status: body.status || 'active',
        model: body.model || 'haiku',
        maxTokens: body.maxTokens || 4096
      });
      return { statusCode: 201, headers: headers, body: JSON.stringify(agent) };
    }

    // ── PUT ──
    if (event.httpMethod === 'PUT') {
      var body = JSON.parse(event.body || '{}');
      if (!body.id) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Agent id is required' }) };
      }
      var updated = await lindy.updateAgent(body.id, body);
      return { statusCode: 200, headers: headers, body: JSON.stringify(updated) };
    }

    // ── DELETE ──
    if (event.httpMethod === 'DELETE') {
      if (!qs.id) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Agent id is required' }) };
      }
      var ok = await lindy.deleteAgent(qs.id);
      return { statusCode: 200, headers: headers, body: JSON.stringify({ success: ok }) };
    }

    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('[lindy-agents] Error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
