/**
 * Shared helper: ClickUp API access.
 *
 * Mirrors the pattern of _notion-url.js / _ghl.js / _claude.js — native
 * Node https, no npm packages. All callers get a consistent
 * { ok, status, body } return shape. Read helpers never throw.
 *
 * This is the ClickUp side of the Notion→ClickUp migration evaluation.
 * It intentionally lives next to _notion-url.js so both stacks can
 * run in parallel during cutover.
 *
 * Env vars read by callers (not here):
 *   CLICKUP_API_TOKEN      — personal or workspace API token
 *   CLICKUP_DEALS_LIST_ID  — List ID of the deal-pipeline List
 *
 * ClickUp API quick-reference:
 *   Base URL:  https://api.clickup.com/api/v2
 *   Auth:      Authorization: <token>            (no "Bearer" prefix)
 *   List tasks: GET  /list/{list_id}/task?page=N&include_closed=true
 *                   &statuses[]=Open&subtasks=false
 *   Get task:  GET  /task/{task_id}?include_subtasks=false
 *   Create:    POST /list/{list_id}/task        body: { name, status, custom_fields: [...] }
 *   Update:    PUT  /task/{task_id}             body: { name?, status?, ... }
 *   Field set: POST /task/{task_id}/field/{field_id}  body: { value }
 *
 * Pagination: `page` is 0-based, 100 tasks per page. Response has
 * `last_page: true` when exhausted.
 *
 * Custom fields are attached to every task under `custom_fields: [{
 *   id, name, type, type_config, value }]`. `value` shape depends on
 * `type` — `extractField()` normalizes the common cases.
 */

const https = require('https');

var CLICKUP_HOST = 'api.clickup.com';
var CLICKUP_API_PREFIX = '/api/v2';

// Core request wrapper. Returns a Promise that ALWAYS resolves with
// { ok, status, body } — never rejects. Callers decide whether a
// non-2xx response is fatal.
function cuRequest(path, token, method, body) {
  return new Promise(function(resolve) {
    var payload = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: CLICKUP_HOST,
      path: CLICKUP_API_PREFIX + path,
      method: method || (body ? 'POST' : 'GET'),
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);

    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        var parsed;
        try { parsed = data ? JSON.parse(data) : {}; } catch(e) { parsed = data; }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed
        });
      });
    });
    req.on('error', function(err) {
      resolve({ ok: false, status: 0, body: { error: err.message } });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// List all tasks in a List, paginating until last_page. Optional filters:
//   statuses    — array of status names to include (server-side filter)
//   includeClosed — include archived/closed tasks (default true — we want
//                   Closed deals for the social-proof section)
//   subtasks    — include subtasks (default false)
//   maxPages    — safety cap (default 20 pages = 2000 tasks)
//
// Returns { ok, tasks, pages, lastError }.
async function listTasks(token, listId, filters) {
  filters = filters || {};
  var maxPages = filters.maxPages || 20;
  var statuses = Array.isArray(filters.statuses) ? filters.statuses : null;
  var includeClosed = filters.includeClosed !== false;
  var subtasks = filters.subtasks === true;

  var all = [];
  var page = 0;
  var lastError = null;

  while (page < maxPages) {
    var q = [
      'page=' + page,
      'include_closed=' + (includeClosed ? 'true' : 'false'),
      'subtasks=' + (subtasks ? 'true' : 'false')
    ];
    if (statuses) {
      statuses.forEach(function(s) {
        q.push('statuses[]=' + encodeURIComponent(s));
      });
    }
    var path = '/list/' + encodeURIComponent(listId) + '/task?' + q.join('&');
    var res = await cuRequest(path, token, 'GET');

    if (!res.ok) {
      lastError = res;
      break;
    }

    var batch = (res.body && res.body.tasks) || [];
    all = all.concat(batch);

    // ClickUp returns `last_page: true` OR fewer than 100 tasks when exhausted.
    var done = res.body && (res.body.last_page === true || batch.length < 100);
    if (done) break;
    page += 1;
  }

  return { ok: !lastError, tasks: all, pages: page + 1, lastError: lastError };
}

// Extract a single custom-field value from a task by field name.
// Normalizes across ClickUp's field-type variations. Returns '' for
// missing / null values, matching Notion's prop() helper semantics so
// callers can swap backends without changing downstream code.
function extractField(task, name) {
  var fields = (task && task.custom_fields) || [];
  var f = null;
  for (var i = 0; i < fields.length; i++) {
    if (fields[i] && fields[i].name === name) { f = fields[i]; break; }
  }
  if (!f) return '';
  var v = f.value;
  if (v === null || v === undefined || v === '') return '';

  switch (f.type) {
    case 'number':
    case 'currency':
    case 'money':
      return (typeof v === 'number') ? v : (+v || 0);

    case 'short_text':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'location':
      return String(v);

    case 'checkbox':
      return v ? 'Yes' : '';

    case 'date':
      // ClickUp returns ms epoch as string or number
      var ms = typeof v === 'number' ? v : parseInt(v, 10);
      if (!ms) return '';
      var d = new Date(ms);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10); // YYYY-MM-DD, matches Notion date.start

    case 'drop_down': {
      // v is either an orderindex (number) or an option UUID (string)
      var opts = (f.type_config && f.type_config.options) || [];
      if (typeof v === 'number') {
        var byIndex = opts.find(function(o) { return o.orderindex === v; }) || opts[v];
        return byIndex ? (byIndex.name || byIndex.label || '') : '';
      }
      var byId = opts.find(function(o) { return o.id === v; });
      return byId ? (byId.name || byId.label || '') : '';
    }

    case 'labels': {
      // v is an array of option UUIDs
      var optL = (f.type_config && f.type_config.options) || [];
      if (!Array.isArray(v)) return '';
      return v.map(function(id) {
        var m = optL.find(function(o) { return o.id === id; });
        return m ? (m.label || m.name || '') : '';
      }).filter(Boolean).join(', ');
    }

    case 'users': {
      // v is array of user objects
      if (!Array.isArray(v)) return '';
      return v.map(function(u) { return u.username || u.email || ''; }).filter(Boolean).join(', ');
    }

    case 'attachment':
    case 'files': {
      if (!Array.isArray(v) || !v.length) return '';
      return v[0].url || v[0].url_w_query || '';
    }

    case 'emoji':
    case 'rating':
      return (typeof v === 'number') ? v : String(v);

    default:
      // Formula, rollup, automatic_progress, etc. — fall back to string.
      if (typeof v === 'object') return '';
      return String(v);
  }
}

// ClickUp task status — the built-in workflow field, NOT a custom field.
// Shape: task.status = { status: 'Actively Marketing', color, orderindex, type }
function extractStatus(task) {
  if (!task || !task.status) return '';
  if (typeof task.status === 'string') return task.status;
  return task.status.status || '';
}

// Convenience: extract the task title (maps to Notion "title" property).
function extractTitle(task) {
  return (task && task.name) ? task.name : '';
}

// Write helpers — scaffolding for the later dispo-buddy-submit port.
// Not used by the read spike but included so the interface is complete.
// All return { ok, status, body }.

async function createTask(token, listId, payload) {
  return cuRequest('/list/' + encodeURIComponent(listId) + '/task', token, 'POST', payload);
}

async function updateTask(token, taskId, payload) {
  return cuRequest('/task/' + encodeURIComponent(taskId), token, 'PUT', payload);
}

// Set a single custom field by field UUID. Use after createTask() if you
// don't want to pass `custom_fields: [...]` on create (simpler error
// handling — a bad field doesn't fail the whole create).
async function setCustomField(token, taskId, fieldId, value) {
  return cuRequest(
    '/task/' + encodeURIComponent(taskId) + '/field/' + encodeURIComponent(fieldId),
    token,
    'POST',
    { value: value }
  );
}

module.exports = {
  cuRequest: cuRequest,
  listTasks: listTasks,
  extractField: extractField,
  extractStatus: extractStatus,
  extractTitle: extractTitle,
  createTask: createTask,
  updateTask: updateTask,
  setCustomField: setCustomField
};
