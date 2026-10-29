# X Helper Libs

Two small, battle-tested Node helpers for X (Twitter) account automation. Used in
production for whitelist / OAuth connect flows.

## lib/x-oauth-connect.js

`oauthAuthorize(account, oauthUrl, opts)` — opens an X OAuth authorize page with the
given account's session and clicks the authorize button **in any UI language**
(Indonesian "Izinkan aplikasi", English "Authorize app", es/pt/zh covered by regex).
Handles both PIN mode and redirect ("Connected") mode.

```js
const { oauthAuthorize } = require('./lib/x-oauth-connect');

const account = { xAuthToken: '...', ct0: '...', walletId: 'my-wallet', proxy: 'http://user:pass@host:port' };
const r = await oauthAuthorize(account, 'https://api.x.com/oauth/authenticate?oauth_token=...');
// r = { ok, clicked, connected, pin, url, text }
```

- `account` shape: `{ xAuthToken, ct0?, walletId, proxy }`.
  If `ct0` is missing, a random one is seeded (X accepts it for auth_token-only sessions).
- Pool resolution: prefers a sibling `browser-pool.js` (patchright or playwright),
  falls back to the module named by `BROWSER_POOL_PATH` if that is not present.
- `opts.waitSeconds` (default 20) controls how long it polls for the button.

## lib/chromium-cookies.js

`cookiesFromProfile(profileDir)` — decrypts `auth_token` + `ct0` from a Chromium /
Playwright profile's Cookies DB (Linux "basic" password store). Useful to reuse X
accounts that are already logged in inside a browser profile, without logging in again.

```js
const { cookiesFromProfile } = require('./lib/chromium-cookies');
const { auth_token, ct0 } = cookiesFromProfile('/path/to/chromium-profile').cookies;
```

Decryption scheme: `PBKDF2("peanuts","saltysalt",1,16)` → AES-128-CBC, IV = 16 spaces.
v10/v11 blobs = 3-byte tag + 32-byte sha256(host_key) prefix + plaintext + PKCS7 pad.
Reads the SQLite DB via python3 stdlib (no native deps needed).

## Gotchas (learned the hard way)

1. **1 X account = 1 wallet** on apps that OAuth-bind accounts server-side (some WL
   apps reject "this X account is already linked to another wallet"). Plan one account
   per wallet.
2. **X testid trap**: when an action succeeds, X changes the button testid to
   `unlike` / `unretweet` — naive verifiers looking for `liked` report false negatives.
   Click via DOM `evaluate()` and verify the *state*, not the click.
3. **Chromium orphan locks**: after a SIGKILL, the pool's profile dir stays locked
   ("Opening in existing browser session"). Fix: `ps aux | grep profiles/<walletId>`,
   kill those PIDs, `rm profiles/<walletId>/Singleton*`.
4. **OAuth UI language**: the authorize page renders in the account's language. Don't
   match buttons by English text only — this lib already handles it.

## Requirements

- Node 18+; playwright or patchright resolvable (via a sibling `browser-pool`)
- python3 (stdlib sqlite3) for the cookie decryptor
