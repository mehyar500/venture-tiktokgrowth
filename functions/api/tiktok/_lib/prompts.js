// functions/api/tiktok/_lib/prompts.js
// Prompt library for the TikTok Growth System. Every prompt is built for
// JSON-mode structured output and engineered against generic filler and
// compliance violations:
//
//   (a) assigns a sharp practitioner persona,
//   (b) bans filler phrases and unproven superlatives,
//   (c) carries the COMPLIANCE block: original-content methods only — no
//       bots/automation, no income or follower promises, no hacks,
//   (d) appends a PRE-FLIGHT self-check before emitting.
//
// Usage: teaserHooks(inputs) -> {system, user, model, json}
//        fullHooks(inputs)    -> {system, user, model, json}
//        fullPlan(inputs, hooksSummary) -> {system, user, model, json}
//        fullBioPlaybook(inputs) -> {system, user, model, json}
// Callers parse with parseJson() from ./ai.js and validate with the
// validators in ./claims.js.

import { BANNED_PHRASES, BANNED_STYLE } from "./claims.js";

const STYLE_BAN = BANNED_STYLE.map((p) => `"${p}"`).join(", ");

// The compliance block — appended to EVERY prompt's system message.
export const COMPLIANCE =
  `COMPLIANCE (hard rules, violating any of these fails the output): ` +
  `teach ORIGINAL-CONTENT methods only. Never mention, suggest, or imply bots, automation, ` +
  `auto-posting tools, engagement pods, or anything "faceless" or hands-free. Never promise or ` +
  `imply income, follower counts, virality, or guaranteed outcomes. Never suggest tactics that ` +
  `violate TikTok's terms (buying followers/views, botted engagement, reposting others' content ` +
  `as your own). Frame everything as skill plus consistency plus reps. The honest frame is: ` +
  `good hooks earn attention, consistent posting builds skill, and results depend on execution. ` +
  `BANNED SUBSTRINGS (using any fails the output): ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}.`;

const SUPERLATIVES_RULE =
  `SUPERLATIVES: never claim "only", "best", "#1", "number one", or "first" unless the inputs prove it — specificity without proof is still fabrication.`;

const JSON_RULE = `Return ONLY valid JSON matching the schema below. No markdown fences, no commentary, no preamble. If a field has no data, use null or [] — never a placeholder sentence.`;

const NO_EMDASH = `PUNCTUATION: never use em dashes (—). Use commas, colons, or periods instead.`;

// The model invents growth promises mid-output even when the rules are in
// the system prompt (proven in validation). A final self-check before
// emitting catches most of it. Appended to every prompt's user message.
export const PREFLIGHT =
  `PRE-FLIGHT SELF-CHECK — do this BEFORE emitting the JSON: re-read every word you are about to output. ` +
  `Delete or fix: (1) any banned substring from the compliance list; ` +
  `(2) any promise or implication of followers, income, virality, or guaranteed results; ` +
  `(3) any superlative ("only"/"best"/"#1"/"number one"/"first") the inputs don't prove; ` +
  `(4) any phrase from the banned-style list; (5) any em dash. ` +
  `If you can't verify it from the inputs, it doesn't ship.`;

function antiGeneric(extra = "") {
  return (
    `STYLE: write like a practitioner who has posted 500+ videos, not a brochure. Short sentences. ` +
    `Concrete nouns. Specific to the niche in the inputs, never generic. ` +
    `BANNED STYLE PHRASES (using any of these fails the output): ${STYLE_BAN}.\n${extra}`
  );
}

function intakeBlock(inputs) {
  const comfort =
    inputs.on_camera === "comfortable"
      ? "comfortable on camera (talking-head and face-to-camera formats are all fair game)"
      : inputs.on_camera === "getting-there"
        ? "getting comfortable on camera (mix some face-to-camera with voiceover and text-overlay formats)"
        : "prefers off-camera (lean on voiceover, screen recordings, hands-only demos, text-overlay formats; never suggest they must show their face)";
  return (
    `NICHE: ${inputs.niche}\n` +
    `ON-CAMERA COMFORT: ${comfort}\n` +
    `HOURS AVAILABLE PER WEEK: ${inputs.hours_per_week}\n` +
    (inputs.handle ? `HANDLE: @${inputs.handle}\n` : "")
  );
}

// ── TEASER: 5 free hook scripts ────────────────────────────────────────────
export function teaserHooks(inputs) {
  return {
    model: "text",
    json: true,
    system:
      `You are a short-form hook writer. Your whole craft is the first 3 seconds: the spoken or on-screen line that earns the next 3 seconds. ` +
      antiGeneric(`BANNED HOOK MOVES: "POV:", "Hot take:", question-hooks ("Did you know...?"), "Stop scrolling", "This is your sign".`) +
      `\n${COMPLIANCE}\n${SUPERLATIVES_RULE}\n${NO_EMDASH}` +
      `\nWrite 5 distinct opening hooks for this creator's niche, each a literal line they can say or put on screen in the first 3 seconds. Each hook must be specific to THIS niche (name the niche's real situations, tools, or frustrations). Vary the mechanics: direct callout, surprising reframe, specific number or time frame, named mistake, curiosity gap with a concrete payoff. Every hook must work as ORIGINAL content the creator films themselves.`,
    user:
      intakeBlock(inputs) +
      `\n${JSON_RULE}\n${PREFLIGHT}\nSchema:\n{\n  "hooks": [\n    { "hook": "<the literal 3-second line, <= 140 chars>",\n      "why": "<1 sentence: why this earns the next 3 seconds>",\n      "format": "<talking-head|voiceover|text-overlay|demo — matched to their on-camera comfort>" }\n  ]\n}\nExactly 5 hooks, 5 different mechanics.`,
  };
}

// ── FULL 1/3: 30 hook scripts ─────────────────────────────────────────────
export function fullHooks(inputs) {
  return {
    model: "text",
    json: true,
    system:
      `You are a short-form hook writer delivering the paid hook bank: 30 opening hooks, one per day, for a creator's niche. ` +
      antiGeneric(`BANNED HOOK MOVES: "POV:", "Hot take:", question-hooks ("Did you know...?"), "Stop scrolling", "This is your sign".`) +
      `\n${COMPLIANCE}\n${SUPERLATIVES_RULE}\n${NO_EMDASH}` +
      `\nEvery hook: a literal line for the first 3 seconds (spoken or on-screen), <= 140 chars, specific to THIS niche. Rotate mechanics across the 30: direct callout, surprising reframe, specific number/time frame, named beginner mistake, curiosity gap with concrete payoff, contrarian-but-honest take, "the thing nobody tells you about X". why_it_works: 1 sentence of craft (the attention principle). delivery_tip: 1 sentence on filming it well (framing, energy, text overlay), matched to their on-camera comfort. No two hooks may use the same mechanic back-to-back. Every hook must be filmable as ORIGINAL content by this creator.`,
    user:
      intakeBlock(inputs) +
      `\n${JSON_RULE}\n${PREFLIGHT}\nSchema:\n{\n  "hook_scripts": [\n    { "hook": "<literal 3-second line, <= 140 chars>",\n      "why_it_works": "<1 sentence of craft>",\n      "delivery_tip": "<1 sentence, matched to on-camera comfort>" }\n  ]\n}\nExactly 30 hook scripts.`,
  };
}

// ── FULL 2/3: 30-day posting plan ─────────────────────────────────────────
export function fullPlan(inputs, hooksSummary) {
  return {
    model: "text",
    json: true,
    system:
      `You are a content strategist writing a 30-day posting plan for a creator. The plan must respect their real constraint: ${inputs.hours_per_week} hours per week. ` +
      antiGeneric() +
      `\n${COMPLIANCE}\n${SUPERLATIVES_RULE}\n${NO_EMDASH}` +
      `\nPACING: with ${inputs.hours_per_week} hrs/week, plan a sustainable cadence (roughly ${inputs.hours_per_week >= 10 ? "1 video per day" : inputs.hours_per_week >= 5 ? "4-5 videos per week with rest days" : "2-3 videos per week, quality over quantity"}). Rest days are planned, not gaps. ` +
      `WEEKLY ARC: week 1 establishes the creator's lane (who this is for), week 2 goes deeper on the niche's real problems, week 3 experiments with formats, week 4 doubles down on what the creator should measure and repeat. ` +
      `Each day: format (talking-head, voiceover, text-overlay, demo, screen-record, stitch-response, day-in-the-life — matched to on-camera comfort), topic (specific to the niche, 1 line), hook (the opening line), caption_seed (2-3 sentence caption starter with a specific comment prompt). Hooks may build on the hook bank below but must not duplicate it verbatim. Every video is ORIGINAL content the creator makes themselves.`,
    user:
      intakeBlock(inputs) +
      `\nHook bank themes to build on (do not copy verbatim):\n${hooksSummary}\n` +
      `\n${JSON_RULE}\n${PREFLIGHT}\nSchema:\n{\n  "posting_plan": [\n    { "day": <1-30>, "format": "<format>", "topic": "<specific topic, 1 line>",\n      "hook": "<opening line>", "caption_seed": "<2-3 sentence caption starter with a comment prompt>" }\n  ]\n}\nExactly 30 days, day numbers 1-30 in order.`,
  };
}

// ── FULL 3/3: bio pack + trend-jacking playbook ────────────────────────────
export function fullBioPack(inputs) {
  return {
    model: "text",
    json: true,
    system:
      `You are a profile optimizer for short-form creators. One deliverable. ` +
      antiGeneric() +
      `\n${COMPLIANCE}\n${SUPERLATIVES_RULE}\n${NO_EMDASH}` +
      `\nBIO PACK: 3 profile bios for this niche, each <= 150 chars, each following the shape: who this is for + what they get + cadence. Then 3 CTA options (link-in-bio / pinned comment / video CTA), each specific to the niche, each <= 100 chars.`,
    user:
      intakeBlock(inputs) +
      `\n${JSON_RULE}\n${PREFLIGHT}\nSchema:\n{\n  "bios": ["<bio 1>", "<bio 2>", "<bio 3>"],\n  "ctas": ["<cta 1>", "<cta 2>", "<cta 3>"]\n}\nReturn exactly 3 bios and exactly 3 ctas.`,
  };
}

export function fullTrendPlaybook(inputs) {
  return {
    model: "text",
    json: true,
    system:
      `You are a trend analyst for short-form creators. One deliverable. ` +
      antiGeneric() +
      `\n${COMPLIANCE}\n${SUPERLATIVES_RULE}\n${NO_EMDASH}` +
      `\nTREND-JACKING PLAYBOOK: 5 steps for spotting a trend early and adapting it to this niche WITHOUT copying anyone. The 5 steps are: (1) daily trend reconnaissance, (2) the 3-question adaptation filter (does it fit my lane / can I add a real take / can I film it today), (3) sound selection, (4) the 48-hour rule, (5) measuring what to repeat. Then 5 dos and 5 donts: all skill-based, all on-platform. The 5 donts must be: no bots/automation, no reposting others' content as your own, no engagement pods, no buying followers/views, no trend-hopping that breaks your lane.`,
    user:
      intakeBlock(inputs) +
      `\n${JSON_RULE}\n${PREFLIGHT}\nSchema:\n{\n  "steps": [ { "title": "<step title>", "detail": "<3-4 sentences of method>" }, { "title": "<step 2 title>", "detail": "<detail>" }, { "title": "<step 3 title>", "detail": "<detail>" }, { "title": "<step 4 title>", "detail": "<detail>" }, { "title": "<step 5 title>", "detail": "<detail>" } ],\n  "dos": ["<do 1>", "<do 2>", "<do 3>", "<do 4>", "<do 5>"],\n  "donts": ["<dont 1>", "<dont 2>", "<dont 3>", "<dont 4>", "<dont 5>"]\n}\nReturn exactly 5 steps (each with title and detail), exactly 5 dos, and exactly 5 donts.`,
  };
}
