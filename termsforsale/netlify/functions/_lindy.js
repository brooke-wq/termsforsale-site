// Shared Lindy AI helper — Notion store + tool defs + execution engine
// Prefix _ means Netlify will NOT deploy this as a function
//
// Env vars required:
//   NOTION_TOKEN           — Notion integration secret
//   NOTION_LINDY_DB        — Notion database ID for agents + runs
//   ANTHROPIC_API_KEY      — Claude API key (or CLAUDE_API_KEY)
//   GHL_API_KEY            — GoHighLevel API key
//   GHL_LOCATION_ID        — GoHighLevel location ID
//
// Exports:
//   Store:  listAgents, getAgent, createAgent, updateAgent, deleteAgent,
//           createRun, updateRun, listRuns, setupDatabase
//   Engine: runAgent
//   Tools:  TOOL_CATALOG

var crypto = require('crypto');
var ghl = require('./_ghl');

var NOTION_API = 'https://api.notion.com';
var NOTION_VER = '2022-06-28';

var HAIKU   = 'claude-haiku-4-5-20251001';
var SONNET  = 'claude-sonnet-4-20250514';
var CLAUDE_API = 'https://api.anthropic.com/v1/messages';

var COST_HAIKU_IN   = 1.00  / 1e6;
var COST_HAIKU_OUT  = 5.00  / 1e6;
var COST_SONNET_IN  = 3.00  / 1e6;
var COST_SONNET_OUT = 15.00 / 1e6;

// ─── Notion helpers ──────────────────────────────────────────────

function notionToken() {
  return process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || '';
}

function lindyDb() {
  return process.env.NOTION_LINDY_DB || '';
}

async function notionFetch(method, path, body) {
  var opts = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + notionToken(),
      'Notion-Version': NOTION_VER,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(NOTION_API + path, opts);
  var text = await res.text();
  var data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    console.error('[Lindy] Notion ' + method + ' ' + path + ' -> ' + res.status, JSON.stringify(data).slice(0, 300));
  }
  return { ok: res.ok, status: res.status, body: data };
}

// ─── Property helpers ────────────────────────────────────────────

function richText(val) {
  if (!val) return [];
  var str = String(val);
  var chunks = [];
  for (var i = 0; i < str.length; i += 2000) {
    chunks.push({ type: 'text', text: { content: str.slice(i, i + 2000) } });
  }
  return chunks;
}

function readRichText(prop) {
  if (!prop || !prop.rich_text) return '';
  return prop.rich_text.map(function(t) { return t.plain_text || ''; }).join('');
}

function readTitle(prop) {
  if (!prop || !prop.title) return '';
  return prop.title.map(function(t) { return t.plain_text || ''; }).join('');
}

function readSelect(prop) {
  if (!prop || !prop.select) return '';
  return prop.select.name || '';
}

function readMultiSelect(prop) {
  if (!prop || !prop.multi_select) return [];
  return prop.multi_select.map(function(s) { return s.name; });
}

function readNumber(prop) {
  if (!prop || prop.number == null) return 0;
  return prop.number;
}

function readDate(prop) {
  if (!prop || !prop.date || !prop.date.start) return '';
  return prop.date.start;
}

// ─── Agent Store ─────────────────────────────────────────────────

function parseAgent(page) {
  var p = page.properties || {};
  return {
    id: page.id,
    name: readTitle(p['Name']),
    type: readSelect(p['Type']),
    description: readRichText(p['Description']),
    slug: readRichText(p['Slug']),
    systemPrompt: readRichText(p['System Prompt']),
    tools: readMultiSelect(p['Tools']),
    trigger: readSelect(p['Trigger']),
    status: readSelect(p['Status']),
    model: readSelect(p['Model']),
    maxTokens: readNumber(p['Max Tokens']) || 4096,
    runCount: readNumber(p['Run Count']),
    totalCost: readNumber(p['Total Cost']),
    lastRun: readDate(p['Last Run']),
    created: page.created_time || ''
  };
}

async function listAgents() {
  var dbId = lindyDb();
  if (!dbId) throw new Error('NOTION_LINDY_DB not configured');
  var res = await notionFetch('POST', '/v1/databases/' + dbId + '/query', {
    filter: { property: 'Type', select: { equals: 'agent' } },
    sorts: [{ property: 'Name', direction: 'ascending' }],
    page_size: 100
  });
  if (!res.ok) throw new Error('Failed to list agents: ' + res.status);
  return (res.body.results || []).map(parseAgent);
}

async function getAgent(id) {
  var res = await notionFetch('GET', '/v1/pages/' + id);
  if (!res.ok) throw new Error('Agent not found: ' + id);
  var agent = parseAgent(res.body);
  // Also fetch page blocks for system prompt if not in properties
  if (!agent.systemPrompt) {
    var blocks = await notionFetch('GET', '/v1/blocks/' + id + '/children?page_size=100');
    if (blocks.ok && blocks.body.results) {
      agent.systemPrompt = blocks.body.results.map(function(b) {
        if (b.type === 'paragraph' && b.paragraph) {
          return (b.paragraph.rich_text || []).map(function(t) { return t.plain_text || ''; }).join('');
        }
        if (b.type === 'code' && b.code) {
          return (b.code.rich_text || []).map(function(t) { return t.plain_text || ''; }).join('');
        }
        return '';
      }).filter(Boolean).join('\n\n');
    }
  }
  return agent;
}

function agentProps(data) {
  var props = {};
  if (data.name != null)        props['Name'] = { title: richText(data.name) };
  if (data.description != null) props['Description'] = { rich_text: richText(data.description) };
  if (data.slug != null)        props['Slug'] = { rich_text: richText(data.slug) };
  if (data.systemPrompt != null) props['System Prompt'] = { rich_text: richText(data.systemPrompt) };
  if (data.tools != null)       props['Tools'] = { multi_select: data.tools.map(function(t) { return { name: t }; }) };
  if (data.trigger != null)     props['Trigger'] = { select: { name: data.trigger } };
  if (data.status != null)      props['Status'] = { select: { name: data.status } };
  if (data.model != null)       props['Model'] = { select: { name: data.model } };
  if (data.maxTokens != null)   props['Max Tokens'] = { number: data.maxTokens };
  if (data.runCount != null)    props['Run Count'] = { number: data.runCount };
  if (data.totalCost != null)   props['Total Cost'] = { number: data.totalCost };
  if (data.lastRun != null)     props['Last Run'] = { date: { start: data.lastRun } };
  props['Type'] = { select: { name: 'agent' } };
  return props;
}

async function createAgent(data) {
  var dbId = lindyDb();
  if (!dbId) throw new Error('NOTION_LINDY_DB not configured');
  if (!data.slug) {
    data.slug = (data.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  var res = await notionFetch('POST', '/v1/pages', {
    parent: { database_id: dbId },
    properties: agentProps(data)
  });
  if (!res.ok) throw new Error('Failed to create agent: ' + JSON.stringify(res.body));
  return parseAgent(res.body);
}

async function updateAgent(id, data) {
  var res = await notionFetch('PATCH', '/v1/pages/' + id, {
    properties: agentProps(data)
  });
  if (!res.ok) throw new Error('Failed to update agent: ' + JSON.stringify(res.body));
  return parseAgent(res.body);
}

async function deleteAgent(id) {
  var res = await notionFetch('PATCH', '/v1/pages/' + id, { archived: true });
  return res.ok;
}

// ─── Run Store ───────────────────────────────────────────────────

function parseRun(page) {
  var p = page.properties || {};
  return {
    id: page.id,
    title: readTitle(p['Name']),
    type: readSelect(p['Type']),
    agentId: readRichText(p['Agent ID']),
    agentName: readRichText(p['Agent Name']),
    input: readRichText(p['Input']),
    output: readRichText(p['Output']),
    status: readSelect(p['Status']),
    duration: readNumber(p['Duration']),
    cost: readNumber(p['Cost']),
    inputTokens: readNumber(p['Input Tokens']),
    outputTokens: readNumber(p['Output Tokens']),
    toolCalls: readNumber(p['Tool Calls']),
    error: readRichText(p['Error']),
    created: page.created_time || ''
  };
}

async function createRun(data) {
  var dbId = lindyDb();
  if (!dbId) throw new Error('NOTION_LINDY_DB not configured');
  var now = new Date().toISOString();
  var title = (data.agentName || 'Agent') + ' · ' + new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  var props = {
    'Name': { title: richText(title) },
    'Type': { select: { name: 'run' } },
    'Agent ID': { rich_text: richText(data.agentId || '') },
    'Agent Name': { rich_text: richText(data.agentName || '') },
    'Input': { rich_text: richText((data.input || '').slice(0, 2000)) },
    'Status': { select: { name: data.status || 'running' } }
  };
  var res = await notionFetch('POST', '/v1/pages', {
    parent: { database_id: dbId },
    properties: props
  });
  if (!res.ok) {
    console.error('[Lindy] Failed to create run:', JSON.stringify(res.body).slice(0, 300));
    return null;
  }
  return parseRun(res.body);
}

async function updateRun(id, data) {
  var props = {};
  if (data.status != null)       props['Status'] = { select: { name: data.status } };
  if (data.output != null)       props['Output'] = { rich_text: richText((data.output || '').slice(0, 2000)) };
  if (data.duration != null)     props['Duration'] = { number: data.duration };
  if (data.cost != null)         props['Cost'] = { number: Math.round(data.cost * 1e6) / 1e6 };
  if (data.inputTokens != null)  props['Input Tokens'] = { number: data.inputTokens };
  if (data.outputTokens != null) props['Output Tokens'] = { number: data.outputTokens };
  if (data.toolCalls != null)    props['Tool Calls'] = { number: data.toolCalls };
  if (data.error != null)        props['Error'] = { rich_text: richText((data.error || '').slice(0, 2000)) };
  var res = await notionFetch('PATCH', '/v1/pages/' + id, { properties: props });
  return res.ok;
}

async function listRuns(opts) {
  var dbId = lindyDb();
  if (!dbId) throw new Error('NOTION_LINDY_DB not configured');
  var filter = { property: 'Type', select: { equals: 'run' } };
  if (opts && opts.agentId) {
    filter = {
      and: [
        { property: 'Type', select: { equals: 'run' } },
        { property: 'Agent ID', rich_text: { equals: opts.agentId } }
      ]
    };
  }
  var res = await notionFetch('POST', '/v1/databases/' + dbId + '/query', {
    filter: filter,
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: (opts && opts.limit) || 50
  });
  if (!res.ok) throw new Error('Failed to list runs: ' + res.status);
  return (res.body.results || []).map(parseRun);
}

// ─── Tool Catalog ────────────────────────────────────────────────

var TOOL_CATALOG = {
  search_contacts: {
    name: 'search_contacts',
    description: 'Search GHL CRM contacts by name, email, phone, or any query string. Returns up to 20 matching contacts with their id, name, email, phone, tags, and custom fields.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — name, email, phone, or keyword' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 100)' }
      },
      required: ['query']
    }
  },
  get_contact: {
    name: 'get_contact',
    description: 'Get full details for a single GHL contact by their contact ID. Returns name, email, phone, tags, custom fields, and notes.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' }
      },
      required: ['contactId']
    }
  },
  add_tags: {
    name: 'add_tags',
    description: 'Add one or more tags to a GHL contact. Tags are used for segmentation and automation triggers.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' }
      },
      required: ['contactId', 'tags']
    }
  },
  remove_tags: {
    name: 'remove_tags',
    description: 'Remove one or more tags from a GHL contact.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' }
      },
      required: ['contactId', 'tags']
    }
  },
  post_note: {
    name: 'post_note',
    description: 'Add a note to a GHL contact record. Notes are visible in the CRM timeline.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        body: { type: 'string', description: 'Note content (plain text or HTML)' }
      },
      required: ['contactId', 'body']
    }
  },
  send_sms: {
    name: 'send_sms',
    description: 'Send an SMS message to a GHL contact. IMPORTANT: This sends a real text message. Use thoughtfully.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID to send SMS to' },
        message: { type: 'string', description: 'SMS message text (keep under 160 chars when possible)' }
      },
      required: ['contactId', 'message']
    }
  },
  send_email: {
    name: 'send_email',
    description: 'Send an email to a GHL contact. Sent from Brooke Froehlich <brooke@mydealpros.com>.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        subject: { type: 'string', description: 'Email subject line' },
        html: { type: 'string', description: 'Email body as HTML' }
      },
      required: ['contactId', 'subject', 'html']
    }
  },
  query_deals: {
    name: 'query_deals',
    description: 'Query the Notion deals database. Returns active real estate deals with city, state, price, deal type, entry fee, and more.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Deal status filter (default: "Actively Marketing")' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      }
    }
  },
  update_contact: {
    name: 'update_contact',
    description: 'Update fields on a GHL contact (firstName, lastName, email, phone, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        fields: { type: 'object', description: 'Key-value pairs to update (firstName, lastName, email, phone, address1, city, state, postalCode, etc.)' }
      },
      required: ['contactId', 'fields']
    }
  },
  create_contact: {
    name: 'create_contact',
    description: 'Create or update a contact in GHL CRM. If email/phone matches existing contact, updates it.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Contact email' },
        phone: { type: 'string', description: 'Contact phone' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply' },
        source: { type: 'string', description: 'Lead source (default: "Lindy AI")' }
      },
      required: ['email']
    }
  }
};

// ─── Tool Execution ──────────────────────────────────────────────

async function executeTool(name, input) {
  var apiKey = process.env.GHL_API_KEY;
  var locId = process.env.GHL_LOCATION_ID;

  switch (name) {
    case 'search_contacts': {
      var limit = Math.min(input.limit || 20, 100);
      var res = await ghl.searchContacts(apiKey, locId, input.query, limit);
      var contacts = (res.body && res.body.contacts) || [];
      return contacts.map(function(c) {
        return {
          id: c.id,
          name: (c.firstName || '') + ' ' + (c.lastName || ''),
          email: c.email || '',
          phone: c.phone || '',
          tags: c.tags || [],
          dateAdded: c.dateAdded || ''
        };
      });
    }

    case 'get_contact': {
      var res = await ghl.getContact(apiKey, input.contactId);
      var c = res.body && res.body.contact ? res.body.contact : res.body;
      if (!c || !c.id) return { error: 'Contact not found' };
      return {
        id: c.id,
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        email: c.email || '',
        phone: c.phone || '',
        tags: c.tags || [],
        city: c.city || '',
        state: c.state || '',
        source: c.source || '',
        dateAdded: c.dateAdded || '',
        customFields: ghl.cfMap(c)
      };
    }

    case 'add_tags': {
      var res = await ghl.addTags(apiKey, input.contactId, input.tags);
      return { success: res.status < 400, tags: input.tags };
    }

    case 'remove_tags': {
      var res = await ghl.removeTags(apiKey, input.contactId, input.tags);
      return { success: res.status < 400, tags: input.tags };
    }

    case 'post_note': {
      var res = await ghl.postNote(apiKey, input.contactId, input.body);
      return { success: res.status < 400 };
    }

    case 'send_sms': {
      if (ghl.isTest()) {
        console.log('[Lindy TEST] SMS to ' + input.contactId + ': ' + input.message);
        return { success: true, test: true };
      }
      var res = await ghl.sendEmail ? null : null;
      // Use conversations API via ghlRequest
      var smsRes = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'SMS',
          contactId: input.contactId,
          message: input.message
        })
      });
      return { success: smsRes.ok };
    }

    case 'send_email': {
      if (ghl.isTest()) {
        console.log('[Lindy TEST] Email to ' + input.contactId + ': ' + input.subject);
        return { success: true, test: true };
      }
      var res = await ghl.sendEmail(apiKey, input.contactId, input.subject, input.html);
      return { success: res.status < 400 };
    }

    case 'query_deals': {
      var notionDb = process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
      var status = input.status || 'Actively Marketing';
      var qRes = await notionFetch('POST', '/v1/databases/' + notionDb + '/query', {
        filter: { property: 'Deal Status', status: { equals: status } },
        page_size: Math.min(input.limit || 20, 100)
      });
      if (!qRes.ok) return { error: 'Notion query failed', status: qRes.status };
      return (qRes.body.results || []).map(function(pg) {
        var pr = pg.properties || {};
        return {
          id: pg.id,
          dealId: readRichText(pr['Deal ID']),
          streetAddress: readRichText(pr['Street Address']) || readTitle(pr['Street Address']),
          city: readRichText(pr['City']) || readSelect(pr['City']),
          state: readRichText(pr['State']) || readSelect(pr['State']),
          zip: readRichText(pr['Zip']) || readRichText(pr['ZIP']),
          dealType: readSelect(pr['Deal Type']),
          askingPrice: readNumber(pr['Asking Price']),
          entryFee: readNumber(pr['Entry Fee']) || readNumber(pr['If not Cash']),
          arv: readNumber(pr['ARV']),
          status: readSelect(pr['Deal Status'])
        };
      });
    }

    case 'update_contact': {
      var res = await ghl.updateContact(apiKey, input.contactId, input.fields);
      return { success: res.status < 400 };
    }

    case 'create_contact': {
      var id = await ghl.upsertContact({
        email: input.email,
        phone: input.phone || '',
        firstName: input.firstName || '',
        lastName: input.lastName || '',
        tags: input.tags || [],
        source: input.source || 'Lindy AI'
      });
      return { success: !!id, contactId: id };
    }

    default:
      return { error: 'Unknown tool: ' + name };
  }
}

// ─── Execution Engine ────────────────────────────────────────────

var MAX_ROUNDS = 8;
var TIMEOUT_MS = 24000; // 24s to stay under Netlify's 26s limit

async function runAgent(agent, userInput) {
  var startTime = Date.now();
  var modelId = agent.model === 'sonnet' ? SONNET : HAIKU;
  var costIn  = agent.model === 'sonnet' ? COST_SONNET_IN  : COST_HAIKU_IN;
  var costOut = agent.model === 'sonnet' ? COST_SONNET_OUT : COST_HAIKU_OUT;
  var maxTokens = agent.maxTokens || 4096;

  // Build tool definitions from agent's enabled tools
  var toolDefs = (agent.tools || []).map(function(t) {
    return TOOL_CATALOG[t];
  }).filter(Boolean);

  var messages = [{ role: 'user', content: userInput }];

  var totalIn = 0;
  var totalOut = 0;
  var totalToolCalls = 0;
  var toolsUsed = [];
  var finalText = '';

  for (var round = 0; round < MAX_ROUNDS; round++) {
    // Check timeout
    if (Date.now() - startTime > TIMEOUT_MS) {
      finalText = finalText || '[Agent timed out after ' + round + ' rounds]';
      break;
    }

    // Build Claude request
    var body = {
      model: modelId,
      max_tokens: maxTokens,
      messages: messages
    };
    if (agent.systemPrompt) body.system = agent.systemPrompt;
    if (toolDefs.length > 0) body.tools = toolDefs;

    var apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
    var res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    var resText = await res.text();
    var data;
    try { data = JSON.parse(resText); } catch (e) {
      throw new Error('Claude API non-JSON: ' + resText.slice(0, 200));
    }
    if (!res.ok || data.error) {
      throw new Error('Claude API error ' + res.status + ': ' + (data.error ? data.error.message : resText.slice(0, 200)));
    }

    // Track usage
    var usage = data.usage || {};
    totalIn  += usage.input_tokens  || 0;
    totalOut += usage.output_tokens || 0;

    var content = data.content || [];
    var toolUses = content.filter(function(c) { return c.type === 'tool_use'; });
    var textParts = content.filter(function(c) { return c.type === 'text'; });

    // Capture any text output
    if (textParts.length > 0) {
      finalText = textParts.map(function(t) { return t.text; }).join('\n');
    }

    // If no tool calls, we're done
    if (toolUses.length === 0 || data.stop_reason === 'end_turn') {
      break;
    }

    // Add assistant message with tool calls
    messages.push({ role: 'assistant', content: content });

    // Execute tools and collect results
    var toolResults = [];
    for (var i = 0; i < toolUses.length; i++) {
      var tu = toolUses[i];
      totalToolCalls++;
      if (toolsUsed.indexOf(tu.name) === -1) toolsUsed.push(tu.name);

      console.log('[Lindy] Tool call #' + totalToolCalls + ': ' + tu.name, JSON.stringify(tu.input).slice(0, 200));

      var result;
      try {
        result = await executeTool(tu.name, tu.input);
      } catch (err) {
        console.error('[Lindy] Tool error:', tu.name, err.message);
        result = { error: err.message };
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 8000)
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  var totalCost = (totalIn * costIn) + (totalOut * costOut);
  var duration = Date.now() - startTime;

  console.log('[Lindy] Run complete: model=' + modelId +
    ' rounds=' + (round + 1) +
    ' tools=' + totalToolCalls +
    ' in=' + totalIn + ' out=' + totalOut +
    ' cost=$' + totalCost.toFixed(6) +
    ' duration=' + duration + 'ms');

  return {
    output: finalText,
    duration: duration,
    cost: totalCost,
    inputTokens: totalIn,
    outputTokens: totalOut,
    toolCalls: totalToolCalls,
    toolsUsed: toolsUsed,
    rounds: round + 1
  };
}

// ─── Database Setup ──────────────────────────────────────────────

async function setupDatabase(parentPageId) {
  // If no parent given, try to find the parent of the existing deals DB
  if (!parentPageId) {
    var dealsDb = process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID;
    if (dealsDb) {
      var dbRes = await notionFetch('GET', '/v1/databases/' + dealsDb);
      if (dbRes.ok && dbRes.body.parent) {
        if (dbRes.body.parent.type === 'page_id') {
          parentPageId = dbRes.body.parent.page_id;
        }
      }
    }
  }

  if (!parentPageId) {
    throw new Error('No parent page ID available. Pass parentPageId in the request body, or ensure NOTION_DATABASE_ID is set.');
  }

  // Create a "Lindy AI" parent page
  var pageRes = await notionFetch('POST', '/v1/pages', {
    parent: { page_id: parentPageId },
    properties: {
      title: { title: [{ type: 'text', text: { content: 'Lindy AI' } }] }
    }
  });
  if (!pageRes.ok) throw new Error('Failed to create Lindy page: ' + JSON.stringify(pageRes.body));
  var lindyPageId = pageRes.body.id;

  // Create the combined agents+runs database
  var dbRes = await notionFetch('POST', '/v1/databases', {
    parent: { page_id: lindyPageId },
    title: [{ type: 'text', text: { content: 'Lindy Agents & Runs' } }],
    properties: {
      'Name':          { title: {} },
      'Type':          { select: { options: [{ name: 'agent', color: 'blue' }, { name: 'run', color: 'gray' }] } },
      'Description':   { rich_text: {} },
      'Slug':          { rich_text: {} },
      'System Prompt': { rich_text: {} },
      'Tools':         { multi_select: { options: Object.keys(TOOL_CATALOG).map(function(k) { return { name: k }; }) } },
      'Trigger':       { select: { options: [{ name: 'manual', color: 'default' }, { name: 'webhook', color: 'green' }] } },
      'Status':        { select: { options: [
        { name: 'active', color: 'green' },
        { name: 'paused', color: 'yellow' },
        { name: 'draft', color: 'gray' },
        { name: 'running', color: 'blue' },
        { name: 'complete', color: 'green' },
        { name: 'failed', color: 'red' },
        { name: 'timeout', color: 'orange' }
      ] } },
      'Model':         { select: { options: [{ name: 'haiku', color: 'blue' }, { name: 'sonnet', color: 'purple' }] } },
      'Max Tokens':    { number: {} },
      'Run Count':     { number: {} },
      'Total Cost':    { number: { format: 'dollar' } },
      'Last Run':      { date: {} },
      'Agent ID':      { rich_text: {} },
      'Agent Name':    { rich_text: {} },
      'Input':         { rich_text: {} },
      'Output':        { rich_text: {} },
      'Duration':      { number: {} },
      'Cost':          { number: { format: 'dollar' } },
      'Input Tokens':  { number: {} },
      'Output Tokens': { number: {} },
      'Tool Calls':    { number: {} },
      'Error':         { rich_text: {} }
    }
  });

  if (!dbRes.ok) throw new Error('Failed to create database: ' + JSON.stringify(dbRes.body));

  return {
    databaseId: dbRes.body.id,
    pageId: lindyPageId,
    message: 'Lindy database created! Set NOTION_LINDY_DB=' + dbRes.body.id + ' in your Netlify environment variables.'
  };
}

// ─── Admin Auth ──────────────────────────────────────────────────

function verifyAdmin(event) {
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  var provided = (event.headers || {})['x-admin-password'] ||
                 (event.headers || {})['X-Admin-Password'] || '';
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch (e) { return false; }
}

// ─── Exports ─────────────────────────────────────────────────────

module.exports = {
  // Store
  listAgents: listAgents,
  getAgent: getAgent,
  createAgent: createAgent,
  updateAgent: updateAgent,
  deleteAgent: deleteAgent,
  createRun: createRun,
  updateRun: updateRun,
  listRuns: listRuns,
  setupDatabase: setupDatabase,
  // Engine
  runAgent: runAgent,
  executeTool: executeTool,
  // Tools
  TOOL_CATALOG: TOOL_CATALOG,
  // Auth
  verifyAdmin: verifyAdmin,
  // Helpers
  lindyDb: lindyDb
};
