// lib/chromium-cookies.js v1 — decrypt X cookies from a Chromium/Playwright profile.
// The browser profile's Cookies DB holds the real session cookies (auth_token, ct0).
// Chromium Linux "basic" password store: key = PBKDF2("peanuts","saltysalt",1,16) AES-128-CBC iv=16*' '.
// v10/v11 blobs = 3-byte tag + 32-byte sha256(host) prefix + CBC plaintext + PKCS7 pad.
// Use: const { cookiesFromProfile } = require('./chromium-cookies');
//      const { auth_token, ct0 } = cookiesFromProfile('/path/to/chromium-profile').cookies;
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function _key() {
  return crypto.pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
}

function _decrypt(enc, hostKey) {
  if (!enc || enc.length < 40) return null;
  const tag = enc.slice(0, 3).toString("latin1");
  if (tag !== "v10" && tag !== "v11") return null;
  let body = enc.slice(3);
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", _key(), Buffer.alloc(16, 0x20));
    const dec = Buffer.concat([decipher.update(body), decipher.final()]);
    // v10 on Linux: 32-byte sha256(host_key) prefix (chromium >= 96-ish)
    let plain = dec;
    if (plain.length > 32) {
      const hostHash = plain.slice(0, 32);
      const expect = crypto.createHash("sha256").update(hostKey).digest().slice(0, 32);
      if (hostHash.equals(expect)) plain = plain.slice(32);
      // older format: no prefix — keep as-is if hash does not match
    }
    const pad = plain[plain.length - 1];
    if (pad >= 1 && pad <= 16) plain = plain.slice(0, plain.length - pad);
    return plain.toString("utf8");
  } catch (_) {
    return null;
  }
}

function cookiesFromProfile(profileDir, opts) {
  opts = opts || {};
  const candidates = [
    path.join(profileDir, "Default", "Cookies"),
    path.join(profileDir, "Cookies"),
  ];
  const dbPath = candidates.find(p => fs.existsSync(p));
  if (!dbPath) return { ok: false, error: "no Cookies db in " + profileDir };
  // Read rows via python3 sqlite3 (stdlib — no native deps), decrypt in JS.
  const { execFileSync } = require("child_process");
  let out = { ok: true, profile: profileDir, cookies: {} };
  try {
    const py = "import sqlite3,json,sys\n" +
      "db = sqlite3.connect('" + dbPath + "')\n" +
      "rows = db.execute(\"SELECT host_key, name, encrypted_value FROM cookies WHERE host_key LIKE '%x.com' AND name IN ('auth_token','ct0') ORDER BY expires_utc DESC\").fetchall()\n" +
      "print(json.dumps([[r[0], r[1], bytes(r[2]).hex()] for r in rows]))";
    const res = execFileSync("python3", ["-c", py], { encoding: "utf8", timeout: 30000 });
    const rows = JSON.parse(res.trim().split("\n").pop());
    for (const [hostKey, name, hexv] of rows) {
      if (out.cookies[name]) continue; // first (newest) wins
      const v = _decrypt(Buffer.from(hexv, "hex"), hostKey);
      if (v) out.cookies[name] = v;
    }
  } catch (e) {
    out = { ok: false, error: "sqlite/py: " + e.message.slice(0, 140) };
  }
  return out;
}

module.exports = { cookiesFromProfile };
