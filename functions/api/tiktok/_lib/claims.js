// functions/api/tiktok/_lib/claims.js
// Compliance enforcement for the TikTok Growth System.
//
// This lane carries platform risk, so the product ships ORIGINAL-CONTENT
// methods only. These rules are the hard floor, enforced in THREE layers:
//   1. PROMPTS (prompts.js): every prompt carries the compliance block +
//      banned-phrase list + a pre-flight self-check.
//   2. VALIDATORS (here): findBannedClaims() scans parsed model output; the
//      generate pipeline's validators return a repair nudge naming the hit,
//      so runTextJson retries with a stricter instruction.
//   3. SANITIZER (here): sanitizeManifest() is the last-resort guarantee —
//      any banned substring that survives retries is replaced with a neutral
//      skill-based fallback sentence. Banned copy NEVER ships.
//
// Banned = claims/implications about: income, follower-count promises,
// guaranteed outcomes, algorithm exploits/hacks, buying followers/views,
// "faceless"/hands-free promises. Bots and automation are CONTEXTUAL bans:
// prohibited as endorsements ("use bots to grow"), but required as
// prohibitions in the trend playbook's don'ts ("do not use bots") — the
// scanner is negation-aware so the pipeline doesn't fight itself.

export const BANNED_PHRASES = [
  "guaranteed",
  "guarantee you",
  "passive income",
  "get rich",
  "get rich quick",
  "100k",
  "1m followers",
  "1 million followers",
  "faceless",
  "hands-free",
  "viral hack",
  "algorithm hack",
  "hack the algorithm",
  "explode overnight",
  "overnight success",
];

// Contextual bans: "bots"/"automation" and "buy followers/likes/views" are
// REQUIRED vocabulary in the trend playbook's DON'Ts ("do not use bots",
// "do not buy followers"), where they are prohibitions, not endorsements.
// Flag them only when the sentence does NOT negate them. Endorsement phrasing
// ("use bots to grow", "buy followers cheap") has no negation and is caught.
export const CONTEXTUAL_BANNED = [
  "bot", "bots", "automation", "automate", "automated",
  "buy followers", "buy likes", "buy views",
];

const NEGATION_RE = /\b(no|not|don't|doesn't|never|avoid|without|against|zero|banned?|prohibit\w*|stay away|steer clear)\b/i;

// Filler/superlative bans shared with the prompt layer (style quality).
export const BANNED_STYLE = [
  "visually stunning", "cutting-edge", "state-of-the-art", "leverage",
  "elevate", "game-changer", "revolutionize", "delve", "tapestry",
  "in today's fast-paced digital world", "unlock the power of", "empower",
  "robust", "holistic", "synergy", "best-in-class", "world-class", "next-level",
];

function phraseRegex(p) {
  return new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
}

const ABSOLUTE_RES = BANNED_PHRASES.map(phraseRegex);
const CONTEXTUAL_RES = CONTEXTUAL_BANNED.map((w) =>
  new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "s?\\b", "i")
);

/** Return the banned phrases found in a string (case-insensitive).
 * Contextual words (bots/automation) are reported only when their sentence
 * carries no negation — "do not use bots" is required compliance copy. */
export function findBannedClaims(text) {
  const s = String(text || "");
  const hits = [];
  BANNED_PHRASES.forEach((p, i) => {
    if (ABSOLUTE_RES[i].test(s)) hits.push(p);
  });
  const sentences = s.split(/(?<=[.!?;])\s+|\n/);
  CONTEXTUAL_BANNED.forEach((w, i) => {
    for (const sent of sentences) {
      if (CONTEXTUAL_RES[i].test(sent) && !NEGATION_RE.test(sent)) {
        hits.push(w);
        break;
      }
    }
  });
  return [...new Set(hits)];
}

/** true when a string is clean of all banned claims. */
export function isClean(text) {
  return findBannedClaims(text).length === 0;
}

/**
 * Repair nudge for the runTextJson validator: names the violation so the
 * retry fixes it, and re-states the compliance rule the model broke.
 */
export function complianceRepairNudge(hits, where) {
  return (
    `COMPLIANCE VIOLATION in ${where || "the output"}: it contains the banned phrase(s) ` +
    `"${hits.join('", "')}". This product teaches ORIGINAL-CONTENT methods only. ` +
    `Rewrite that section with zero mention of bots, automation, hacks, income, follower counts, ` +
    `or guaranteed outcomes. Frame everything as skill plus consistency plus reps. ` +
    `If a tactic implies violating TikTok's terms, replace it with an on-platform original-content tactic.`
  );
}

const FALLBACK_HOOK = "Write a hook about the most common beginner mistake in your niche";
const FALLBACK_WHY = "Names a relatable pain point, which earns the first 3 seconds honestly.";

/** Neutral, skill-based fallback sentences used by the sanitizer. */
export function fallbackFor(kind) {
  switch (kind) {
    case "hook":
      return FALLBACK_HOOK;
    case "why":
    case "why_it_works":
      return FALLBACK_WHY;
    case "delivery_tip":
      return "Film it in one take, like you are explaining it to a friend.";
    case "topic":
      return "Answer the question your niche asks most often";
    case "caption_seed":
      return "Restate the hook, add one detail, invite a question in the comments.";
    case "bio":
      return "Teaching [your niche] one short video at a time";
    case "cta":
      return "Follow for the next one";
    case "step_title":
      return "Study what is working in your niche this week";
    case "step_detail":
      return "Spend 20 minutes a day watching top posts in your niche. Note the formats and sounds that keep you watching, then adapt the structure to your own original content.";
    case "do":
      return "Post consistently on a schedule you can sustain";
    case "dont":
      return "Do not use bots, automation, or engagement pods";
    default:
      return "Consistency beats intensity: small, steady reps compound.";
  }
}

/**
 * Walk a value; replace any string containing a banned phrase with the
 * kind-appropriate fallback. kindHint comes from the nearest known key.
 */
function sanitizeValue(value, kindHint) {
  if (typeof value === "string") {
    return isClean(value) ? value : fallbackFor(kindHint || "default");
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, kindHint));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Derive a kind hint from the key name.
      let hint = kindHint;
      const kl = k.toLowerCase();
      if (kl.includes("hook") && !kl.includes("hooks")) hint = "hook";
      else if (kl.includes("why")) hint = "why_it_works";
      else if (kl.includes("delivery") || kl.includes("tip")) hint = "delivery_tip";
      else if (kl.includes("topic")) hint = "topic";
      else if (kl.includes("caption")) hint = "caption_seed";
      else if (kl === "bios" || kl === "bio") hint = "bio";
      else if (kl === "ctas" || kl === "cta") hint = "cta";
      else if (kl === "title") hint = "step_title";
      else if (kl === "detail") hint = "step_detail";
      else if (kl === "dos" || kl === "do") hint = "do";
      else if (kl === "donts" || kl === "dont") hint = "dont";
      out[k] = sanitizeValue(v, hint);
    }
    return out;
  }
  return value;
}

/**
 * Last-resort guarantee: walk the whole manifest and neutralize any banned
 * copy. Returns { manifest, replaced } where replaced counts sanitized strings.
 */
export function sanitizeManifest(manifest) {
  let replaced = 0;
  function walk(value, hint) {
    if (typeof value === "string") {
      if (!isClean(value)) {
        replaced++;
        return fallbackFor(hint || "default");
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, hint));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        let h = hint;
        const kl = k.toLowerCase();
        if (kl === "hook") h = "hook";
        else if (kl.includes("why")) h = "why_it_works";
        else if (kl === "delivery_tip") h = "delivery_tip";
        else if (kl === "topic") h = "topic";
        else if (kl === "caption_seed") h = "caption_seed";
        else if (kl === "bios") h = "bio";
        else if (kl === "ctas") h = "cta";
        else if (kl === "title") h = "step_title";
        else if (kl === "detail") h = "step_detail";
        else if (kl === "dos") h = "do";
        else if (kl === "donts") h = "dont";
        out[k] = walk(v, h);
      }
      return out;
    }
    return value;
  }
  const out = walk(manifest, null);
  // Belt-and-braces: the contract requires posting_plan days to be 1..N in
  // order. Renumber after sanitization regardless of what the model returned.
  if (out && Array.isArray(out.posting_plan)) {
    out.posting_plan.forEach((p, i) => {
      if (p && typeof p === "object") p.day = i + 1;
    });
  }
  return { manifest: out, replaced };
}

/**
 * Validate one generate-pipeline section: schema check + compliance scan.
 * Returns true, or a repair string for runTextJson.
 */
export function sectionValidator(schemaOk, sectionName) {
  return (d) => {
    if (!schemaOk(d)) return false;
    const hits = findBannedClaims(JSON.stringify(d));
    if (hits.length) return complianceRepairNudge(hits, sectionName);
    return true;
  };
}
