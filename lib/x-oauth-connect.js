// lib/x-oauth-connect.js v1 — reusable X OAuth "authorize app" flow (any language UI).
// Use: const { oauthAuthorize } = require('./x-oauth-connect');
//      const r = await oauthAuthorize(account, oauthUrl);  // { ok, connected, pin, url, text }
// account = { xAuthToken, ct0?, walletId, proxy }.
// Handles: id/en authorize buttons, PIN mode, redirect ("Connected") mode.
// Pool note: uses browserPool.launchContext — kill orphan chromium for the walletId
// profile (ps aux | grep profiles/<id>) before rerunning after a SIGKILL.
"use strict";
process.env.DISPLAY = process.env.DISPLAY || ":99";
const crypto = require("crypto");
// Pool resolution: prefer a sibling browser-pool (patchright or playwright); if it is
// not present, fall back to the module named by BROWSER_POOL_PATH.
let browserPool;
try {
  browserPool = require("./browser-pool");
  if (typeof browserPool.launchContext !== "function") throw new Error("no launchContext");
} catch (_) {
  const alt = process.env.BROWSER_POOL_PATH;
  if (!alt) throw new Error("browser-pool not found; put one beside this file or set BROWSER_POOL_PATH");
  browserPool = require(alt);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function oauthAuthorize(account, oauthUrl, opts) {
  opts = opts || {};
  const walletId = account.walletId || "oauth";
  if (!account.xAuthToken) return { ok: false, error: "xAuthToken missing" };
  if (!oauthUrl || !/oauth\/authenticate|oauth\/authorize/.test(oauthUrl)) {
    return { ok: false, error: "oauthUrl does not look like an X oauth link" };
  }
  let seeded;
  try {
    seeded = await browserPool.launchContext(walletId, { proxy: account.proxy });
  } catch (e) {
    return { ok: false, error: "launch: " + e.message.slice(0, 140), hint: "kill orphan chromium for profiles/" + walletId + " + rm Singleton*, then retry" };
  }
  const page = seeded.page;
  try {
    const ct0 = account.ct0 || crypto.randomBytes(16).toString("hex");
    await page.context().addCookies([
      { name: "auth_token", value: account.xAuthToken, domain: ".x.com", path: "/", secure: true, httpOnly: true, sameSite: "None" },
      { name: "ct0", value: ct0, domain: ".x.com", path: "/", secure: true, httpOnly: false, sameSite: "None" },
    ]);
    await page.goto(oauthUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Poll for an authorize/allow button in ANY language (id: "Izinkan aplikasi", en: "Authorize app", pt/es/...).
    let clicked = null;
    for (let i = 0; i < (opts.waitSeconds || 20) && !clicked; i++) {
      await sleep(2000);
      clicked = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button, input[type=submit], input[type=button]"));
        const el = els.find(e => /izinkan|authorize|allow|autorizar|許可|允许|允許/i.test((e.innerText || e.value || "").trim()));
        if (el) { const t = (el.innerText || el.value || "").trim(); el.click(); return t; }
        return null;
      }).catch(() => null);
    }
    await sleep(6000);
    const url = page.url();
    const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 600)).catch(() => "");
    const pinMatch = text.match(/\b(\d{6,8})\b/);
    const connected = /connected|terhubung|terkoneksi|authorization complete/i.test(text) || /oauth\/authorize$/.test(url);
    return {
      ok: true,
      clicked: clicked || null,
      connected,
      pin: pinMatch ? pinMatch[1] : null,
      url,
      text: text.replace(/\n/g, " | ").slice(0, 300),
    };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 160) };
  } finally {
    try { await seeded.release(); } catch (_) {}
  }
}

module.exports = { oauthAuthorize };
