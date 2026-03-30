// Shared Claude API helper — native fetch (Node 18+), no npm packages
// Prefix _ means Netlify will NOT deploy this as a function (it's a private module)
//
// Model: claude-haiku-4-5-20251001 (cheapest, fast)
// Pricing approx: $0.80/MTok input, $4.00/MTok output
//
// Exports: complete(apiKey, { system, user, maxTokens, json })

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// Approximate cost per token (USD)
const COST_PER_INPUT_TOKEN  = 0.80 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 4.00 / 1_000_000;

/**
 * Call Claude API.
 * @param {string} apiKey - ANTHROPIC_API_KEY
 * @param {object} opts
 *   system    {string}  - system prompt
 *   user      {string}  - user message
 *   maxTokens {number}  - max output tokens (default 1024)
 *   json      {boolean} - if true, requests JSON output and parses the response
 * @returns {string|object} - text string, or parsed object if json=true
 */
async function complete(apiKey, { system, user, maxTokens, json }) {
  var max = maxTokens || 1024;

  var messages = [{ role: 'user', content: user }];

  var body = {
    model: CLAUDE_MODEL,
    max_tokens: max,
    messages: messages
  };

  if (system) body.system = system;

  if (json) {
    // Append JSON instruction to avoid extra prose
    body.messages = [{
      role: 'user',
      content: user + '\n\nRespond with valid JSON only. No markdown fences, no explanation.'
    }];
  }

  var res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  var text = await res.text();
  var data;
  try { data = JSON.parse(text); } catch(e) {
    throw new Error('Claude API non-JSON response: ' + text.slice(0, 200));
  }

  if (res.status !== 200 || data.error) {
    throw new Error('Claude API error ' + res.status + ': ' + (data.error ? data.error.message : text.slice(0, 200)));
  }

  // Log token usage and cost
  var usage = data.usage || {};
  var inputTokens  = usage.input_tokens  || 0;
  var outputTokens = usage.output_tokens || 0;
  var cost = (inputTokens * COST_PER_INPUT_TOKEN) + (outputTokens * COST_PER_OUTPUT_TOKEN);
  console.log('[Claude] model=' + CLAUDE_MODEL +
    ' input=' + inputTokens + ' output=' + outputTokens +
    ' cost=$' + cost.toFixed(6));

  var content = (data.content || [])[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude API: unexpected content type: ' + JSON.stringify(data.content));
  }

  var result = content.text || '';

  if (json) {
    // Strip any accidental markdown fences
    result = result.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    try { return JSON.parse(result); }
    catch(e) { throw new Error('Claude returned invalid JSON: ' + result.slice(0, 200)); }
  }

  return result;
}

module.exports = { complete };
