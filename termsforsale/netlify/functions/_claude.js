// Shared Claude API helper — native fetch (Node 18+), no npm packages
// Prefix _ means Netlify will NOT deploy this as a function (it's a private module)
//
// Default model: claude-sonnet-4-20250514 (Sonnet 4)
// Pricing approx: $3.00/MTok input, $15.00/MTok output
//
// Callers should pass { model: 'claude-haiku-4-5-20251001' } to use Haiku
// (much cheaper) when output quality allows — see CLAUDE.md cost rules.
//
// Exports: complete(apiKey, { system, user, maxTokens, json, model })
// Returns: { text, usage: { input_tokens, output_tokens, cost } }

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// Approximate cost per token (USD) for the default model
const COST_PER_INPUT_TOKEN  = 3.00 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15.00 / 1_000_000;
const COST_WARN_THRESHOLD   = 0.15;

/**
 * Call Claude API.
 * @param {string} apiKey - ANTHROPIC_API_KEY
 * @param {object} opts
 *   system    {string}  - system prompt
 *   user      {string}  - user message
 *   maxTokens {number}  - max output tokens (default 1024)
 *   json      {boolean} - if true, requests JSON output and parses the response
 *   model     {string}  - override model (default: CLAUDE_MODEL)
 * @returns {{ text: string|object, usage: { input_tokens, output_tokens, cost } }}
 */
async function complete(apiKey, { system, user, maxTokens, json, model }) {
  var max = maxTokens || 1024;
  var theModel = model || CLAUDE_MODEL;

  var messages = [{ role: 'user', content: user }];

  var body = {
    model: theModel,
    max_tokens: max,
    messages: messages
  };

  if (system) body.system = system;

  if (json) {
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

  // Calculate token usage and cost. Haiku is ~25x cheaper than Sonnet; use
  // the cheaper rates when a Haiku model is in play so the cost log is honest.
  var usage = data.usage || {};
  var inputTokens  = usage.input_tokens  || 0;
  var outputTokens = usage.output_tokens || 0;
  var isHaiku = /haiku/i.test(theModel);
  var inRate  = isHaiku ? (1.00 / 1_000_000) : COST_PER_INPUT_TOKEN;
  var outRate = isHaiku ? (5.00 / 1_000_000) : COST_PER_OUTPUT_TOKEN;
  var cost = (inputTokens * inRate) + (outputTokens * outRate);

  console.log('[Claude] model=' + theModel +
    ' input=' + inputTokens + ' output=' + outputTokens +
    ' cost=$' + cost.toFixed(6));

  if (cost > COST_WARN_THRESHOLD) {
    console.warn('[Claude] WARNING: single call cost $' + cost.toFixed(4) + ' exceeds $' + COST_WARN_THRESHOLD + ' threshold');
  }

  var usageObj = { input_tokens: inputTokens, output_tokens: outputTokens, cost: cost };

  var content = (data.content || [])[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude API: unexpected content type: ' + JSON.stringify(data.content));
  }

  var result = content.text || '';

  if (json) {
    // Strip any accidental markdown fences
    result = result.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    try { return { text: JSON.parse(result), usage: usageObj }; }
    catch(e) { throw new Error('Claude returned invalid JSON: ' + result.slice(0, 200)); }
  }

  return { text: result, usage: usageObj };
}

module.exports = { complete };
