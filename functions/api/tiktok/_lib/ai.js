// functions/api/tiktok/_lib/ai.js
// Thin Workers AI helpers for the TikTok Growth System. No secrets, no
// hardcoded keys — everything runs through the env.AI binding.
//
// Model lessons baked in (see ~/AGENTS.md):
// - @cf/meta/llama-3.3-70b-instruct-fp8-fast with response_format json_object
//   returns result.response PRE-PARSED as a JS object, NOT a string.
//   String(obj) gives "[object Object]" and silently kills every JSON parse
//   downstream. aiText() below serializes objects back to JSON so parseJson()
//   sees the real payload either way.
// - First live Workers AI call can take ~480s wall clock (queue/cold);
//   subsequent calls ~6s. Don't mistake a queued first call for a hang.
// - llama-3.3-70b-instruct-fp8-fast is the house pick for all
//   customer-facing copy (~$0.002/deliverable); 8b writes mediocre filler.

/**
 * Extract generated text from an env.AI.run() result (string or pre-parsed
 * object; see the model lesson above).
 */
function aiText(out) {
  if (typeof out === "string") return out;
  const r = out && out.response;
  if (r == null) return "";
  return typeof r === "string" ? r : JSON.stringify(r);
}

export const MODELS = {
  text: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", // strong writing/reasoning
  textFast: "@cf/meta/llama-3.2-3b-instruct", // cheap, high-volume
};

/**
 * Run a chat/text model. Returns the raw response string (trimmed).
 * jsonMode adds response_format json_object; callers must still parseJson().
 */
export async function runText(env, model, messages, opts = {}) {
  const { max_tokens = 2048, temperature = 0.7, jsonMode = false } = opts;
  const body = { messages, max_tokens, temperature };
  if (jsonMode) body.response_format = { type: "json_object" };
  const out = await env.AI.run(model, body);
  return aiText(out).trim();
}

/** Parse model output as JSON; tolerates ```json fences. Returns null on failure.
 * Fallback layers, in order:
 *   1. strict JSON.parse
 *   2. fenced ```json block
 *   3. outermost {...} block
 *   4. Python-dict normalization (single quotes -> double) — llama-3.3-70b
 *      emits single-quoted "JSON" despite json_object mode; observed in
 *      validation repeatedly. Applied only to candidates that failed strict
 *      parsing, so valid JSON never passes through the normalizer. */
/** Convert single-quoted Python-dict-ish output to valid JSON.
 * Handles: 'key': 'value', 'key': "value", trailing commas, True/False/None.
 * String contents with apostrophes (e.g. "it's") are preserved: the regex
 * only rewrites quotes that are structural (followed/preceded by : , { [ }). */
function normalizePyDict(s) {
  return s
    // \' is not valid JSON anywhere; in single-quoted model output it is an
    // escaped apostrophe — stash it as a placeholder so the quote rewriting
    // below does not mistake it for a structural quote, then restore it.
    .replace(/\\'/g, "__APOS__")
    // 'key':  ->  "key":
    .replace(/([{,\s])'([^'\n]*?)'(\s*:)/g, '$1"$2"$3')
    // : 'value'  ->  : "value"   (and [ 'value' / , 'value')
    .replace(/([:\[,\]\s])'([^'\n]*?)'(\s*[,}\]])/g, '$1"$2"$3')
    // trailing commas before } or ]
    .replace(/,\s*([}\]])/g, "$1")
    // Python literals
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/__APOS__/g, "'");
}

export function parseJson(s) {
  if (!s) return null;
  const candidates = [s];
  const m = /```(?:json)?\s*([\s\S]+?)\s*```/i.exec(s);
  if (m) candidates.push(m[1]);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(s.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {}
    const norm = normalizePyDict(c);
    if (norm !== c) {
      try {
        return JSON.parse(norm);
      } catch {}
    }
  }
  return null;
}

/**
 * Run a JSON-mode text call with schema validation and bounded retries.
 * validate(parsed) must return true for acceptable output. On parse failure
 * or validation failure, the model is re-prompted with a repair nudge that
 * quotes the specific problem. Throws after retries are exhausted.
 */
export async function runTextJson(env, model, messages, opts = {}) {
  const { max_tokens = 2048, temperature = 0.7, retries = 2, validate = null, label = "json" } = opts;
  let lastErr = "unknown";
  let msgs = messages;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await runText(env, model, msgs, { max_tokens, temperature, jsonMode: true });
    const parsed = parseJson(text);
    if (!parsed) {
      lastErr = "parse_failed";
    } else if (validate) {
      // A validator may return true (pass), false (generic fail), or a
      // string naming the failure (surfaced in the repair nudge).
      const v = validate(parsed);
      if (v === true) {
        return { parsed, attempts: attempt + 1 };
      }
      lastErr = typeof v === "string" && v ? v : "schema_validation_failed";
    } else {
      return { parsed, attempts: attempt + 1 };
    }
    // Repair nudge: name the failure so the next attempt fixes it.
    const why = lastErr === "parse_failed"
      ? "was not valid JSON"
      : lastErr === "schema_validation_failed"
        ? "did not match the required schema"
        : lastErr; // specific validator reason, used verbatim
    msgs = [
      ...messages,
      {
        role: "user",
        content:
          `Your last response ${why}. ` +
          `Reply with ONLY a corrected JSON object matching the schema — no prose, no fences, no apologies.`,
      },
    ];
  }
  throw new Error(`runTextJson(${label}) failed after ${retries + 1} attempts: ${lastErr}`);
}

/** Run fn over items with bounded concurrency; results stay in input order. */
export async function boundedMap(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (err) {
        out[idx] = { ok: false, error: String((err && err.message) || err) };
      }
    }
  }
  const pool = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) pool.push(worker());
  await Promise.all(pool);
  return out;
}
