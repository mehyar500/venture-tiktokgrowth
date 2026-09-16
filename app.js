/* TikTok Growth System - shared app logic.
 *
 * PRODUCTION DEFAULT: buy buttons POST the real payload to
 * https://mehyar.us/api/pay/checkout and redirect to Stripe.
 * DEV MODE is opt-in ONLY via ?dev=1 (shows the payload modal instead of
 * charging). Never the default, never silent.
 */
"use strict";

/* Explicit opt-in: ?dev=1. Anything else = production checkout. */
const DEV_MODE = new URLSearchParams(window.location.search).get("dev") === "1";
const CHECKOUT_URL = "https://mehyar.us/api/pay/checkout";
const TEASER_URL = "/api/tiktok/teaser";

/* Last submitted teaser inputs - folded into the checkout params so the
 * paid pipeline starts with the buyer's intake. */
window.__teaserInputs = window.__teaserInputs || {};

const PRODUCT_ID = "tiktokgrowth-system";
const SUCCESS_URL = "https://tiktokgrowth.mehyar.us/success.html";
const CANCEL_URL = "https://tiktokgrowth.mehyar.us/#pricing";

/* ---------- helpers ---------- */
function $(sel, root) {
  return (root || document).querySelector(sel);
}
function $all(sel, root) {
  return Array.from((root || document).querySelectorAll(sel));
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim());
}

/* ---------- buy modal ---------- */
function openBuyModal() {
  const modal = $("#buy-modal");
  $("#buy-email").value = "";
  $("#buy-error").textContent = "";
  modal.hidden = false;
  $("#buy-email").focus();
}

function closeBuyModal() {
  $("#buy-modal").hidden = true;
}

function intakeParams() {
  const saved = window.__teaserInputs || {};
  const params = {};
  if (saved.niche) params.niche = String(saved.niche).slice(0, 120);
  if (saved.on_camera) params.on_camera = String(saved.on_camera).slice(0, 40);
  if (saved.hours_per_week) params.hours_per_week = String(saved.hours_per_week).slice(0, 10);
  if (saved.handle) params.handle = String(saved.handle).slice(0, 80);
  return params;
}

function checkoutPayload(email, params) {
  const payload = {
    product_id: PRODUCT_ID,
    email: email,
    params: params || {},
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
  };
  if (DEV_MODE) payload.test = true; // dev checkout only ever hits test mode
  return payload;
}

function devCheckout(email, params) {
  /* DEV_MODE (?dev=1): never call the real endpoint. Show exactly what WOULD be sent. */
  const payload = checkoutPayload(email, params);
  $("#payload-pre").textContent = "POST " + CHECKOUT_URL + "\n\n" + JSON.stringify(payload, null, 2);
  $("#payload-modal").hidden = false;
}

/* Production checkout: POST the real payload, redirect to Stripe. */
async function liveCheckout(email, params) {
  const payload = checkoutPayload(email, params);
  let res;
  try {
    res = await fetch(CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: "Couldn't reach checkout - check your connection and try again." };
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* fall through */ }
  if (!res.ok || !data || data.ok !== true || !data.checkout_url) {
    const msg = (data && (data.message || data.error)) || ("Checkout failed (HTTP " + res.status + ").");
    return { ok: false, error: String(msg).slice(0, 200) };
  }
  window.location.href = data.checkout_url;
  return { ok: true };
}

/* Wire all [data-buy] buttons on the page */
function wireBuyButtons() {
  $all("[data-buy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openBuyModal();
    });
  });
}

/* ---------- teaser ---------- */
function readTeaserInputs(form) {
  const niche = $("#teaser-niche", form).value.trim();
  const on_camera = $("#teaser-on-camera", form).value;
  const hoursRaw = $("#teaser-hours", form).value.trim();
  const handle = $("#teaser-handle", form).value.trim().replace(/^@+/, "");
  return {
    niche: niche,
    on_camera: on_camera,
    hours_per_week: Math.max(1, Math.min(40, parseInt(hoursRaw, 10) || 0)),
    handle: handle,
  };
}

async function submitTeaser(form) {
  const resultEl = $("#teaser-result");
  const statusEl = $("#teaser-status");
  resultEl.innerHTML = "";
  statusEl.textContent = "Writing your 5 hooks…";
  statusEl.className = "status busy";

  const data = readTeaserInputs(form);
  if (!data.niche) {
    statusEl.textContent = "Tell us your niche first - the more specific, the better the hooks.";
    statusEl.className = "status error";
    return;
  }
  if (!data.hours_per_week) {
    statusEl.textContent = "How many hours per week can you realistically post? (1-40)";
    statusEl.className = "status error";
    return;
  }

  /* Remember intake inputs so the buy modal can fold them into checkout params */
  window.__teaserInputs = data;

  try {
    const res = await fetch(TEASER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(function () { return null; });
    if (!res.ok || !body || body.ok !== true) {
      const msg = (body && (body.message || body.error)) || ("HTTP " + res.status);
      throw new Error(String(msg));
    }
    renderTeaserResult(body);
    statusEl.textContent = "";
    statusEl.className = "status";

    /* Optional email capture: subscribe to brand + global lists */
    try {
      const emailEl = document.getElementById("teaser-email");
      const email = emailEl ? emailEl.value.trim() : "";
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fetch("/api/tiktok/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, niche: data.niche }),
        }).catch(function () {});
      }
    } catch {}
  } catch (err) {
    statusEl.textContent = "";
    statusEl.className = "status";
    resultEl.innerHTML =
      '<div class="dev-fallback">' +
      "<strong>Couldn't generate the teaser.</strong><br>" +
      esc(err.message || "Request failed") +
      ' - check your connection and try again. If it keeps failing, write to <a href="mailto:info@mehyar.us">info@mehyar.us</a>.' +
      "</div>";
  }
}

function renderTeaserResult(body) {
  const resultEl = $("#teaser-result");
  const hooks = ((body && body.teaser && body.teaser.hooks) || []);
  let html =
    '<div class="free-preview-banner" role="note">' +
    '<span class="free-preview-badge">FREE PREVIEW</span>' +
    '<span>5 hooks for <strong>' + esc(body.niche || "your niche") + "</strong>. " +
    'The $27 playbook ships 30 hooks, a 30-day plan, your bio pack, and the trend playbook.</span>' +
    "</div>";
  html += '<ul class="hook-list">' + hooks.map(function (h, i) {
    return "<li>" +
      '<div class="hook-line">' + esc((i + 1) + ". " + (h.hook || "")) + "</div>" +
      '<div class="hook-why">' + esc(h.why || "") + "</div>" +
      (h.format ? '<span class="hook-format">' + esc(h.format) + "</span>" : "") +
      "</li>";
  }).join("") + "</ul>";
  html +=
    '<div class="teaser-cta">' +
    '<button class="btn btn-primary btn-lg" data-buy>Get the full $27 playbook</button>' +
    '<p class="refund-note">30-day plan · 30 hooks · bio pack · trend playbook · 7-day redo-or-refund</p>' +
    "</div>";
  resultEl.innerHTML = html;
  /* The CTA rendered above needs the buy-modal wiring. */
  wireBuyButtons();
  resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- global wiring (every page) ---------- */
document.addEventListener("DOMContentLoaded", function () {
  wireBuyButtons();

  /* DEV_MODE banner - unmistakable when ?dev=1 is on. */
  if (DEV_MODE && document.body) {
    var banner = document.createElement("div");
    banner.className = "dev-notice";
    banner.style.cssText = "position:sticky;top:0;z-index:9999;text-align:center;padding:8px;font-weight:700";
    banner.textContent = "DEV MODE (?dev=1) - no real checkout, no charges. Remove ?dev=1 for production.";
    document.body.insertBefore(banner, document.body.firstChild);
  }

  var teaserForm = $("#teaser-form");
  if (teaserForm) {
    teaserForm.addEventListener("submit", function (e) {
      e.preventDefault();
      submitTeaser(teaserForm);
    });
  }

  var closeX = $("#buy-close");
  if (closeX) closeX.addEventListener("click", closeBuyModal);

  var buyModal = $("#buy-modal");
  if (buyModal) {
    buyModal.addEventListener("click", function (e) {
      if (e.target === buyModal) closeBuyModal();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && buyModal && !buyModal.hidden) closeBuyModal();
  });

  var buyForm = $("#buy-form");
  if (buyForm) {
    buyForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("#buy-email").value.trim();
      var err = $("#buy-error");
      if (!validEmail(email)) {
        err.textContent = "Enter a valid email - your deliverable goes there.";
        return;
      }
      err.textContent = "";
      var params = intakeParams();
      if (DEV_MODE) {
        devCheckout(email, params);
        closeBuyModal();
        return;
      }
      var btn = buyForm.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Starting secure checkout…";
      }
      liveCheckout(email, params).then(function (r) {
        if (!r.ok) {
          err.textContent = r.error;
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Continue to checkout";
          }
        }
        /* on success the page redirects to Stripe - nothing else to do */
      });
    });
  }

  var payloadClose = $("#payload-close");
  if (payloadClose) payloadClose.addEventListener("click", function () {
    $("#payload-modal").hidden = true;
  });
});
