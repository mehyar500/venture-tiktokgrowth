// functions/api/tiktok/_lib/inputs.js
// Shared input sanitization for the TikTok Growth System endpoints.
// Imported by teaser.js and generate.js so both enforce the same rules.

export function cleanText(s, max = 4000) {
  if (typeof s !== "string") return "";
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export const ON_CAMERA_VALUES = ["comfortable", "getting-there", "prefer-off-camera"];

export function cleanOnCamera(v) {
  const s = cleanText(v, 40).toLowerCase();
  if (ON_CAMERA_VALUES.includes(s)) return s;
  // Tolerate a few human variants from the frontend select.
  if (/prefer|off|camera-shy|no face/i.test(s)) return "prefer-off-camera";
  if (/getting|working|sometimes/i.test(s)) return "getting-there";
  if (/comfortable|confident|yes/i.test(s)) return "comfortable";
  return "";
}

export function cleanHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(40, Math.floor(n)));
}

/** Validate + normalize the intake shape shared by teaser and generate. */
export function cleanIntake(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  return {
    niche: cleanText(src.niche, 120),
    on_camera: cleanOnCamera(src.on_camera),
    hours_per_week: cleanHours(src.hours_per_week),
    handle: cleanText(src.handle, 80).replace(/^@+/, ""),
  };
}

export function intakeErrors(intake) {
  const errs = [];
  if (!intake.niche) errs.push("niche");
  if (!intake.on_camera) errs.push("on_camera");
  if (!intake.hours_per_week || intake.hours_per_week < 1) errs.push("hours_per_week");
  return errs;
}
