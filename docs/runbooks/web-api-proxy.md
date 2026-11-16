# Runbook: the API through the web app's own `/api` (issue #29)

Once this is set up, the web app calls `https://<web>/api/…`, and Vercel forwards each request to
the API on Render. The browser and the API are then one site, so the sign-in session moves into an
`HttpOnly` cookie and no token is left where a script could read it. How it works:
`docs/modules/auth-and-dashboard.md` → "Where the web keeps them".

**Nothing changes until step 3.** The code ships inert: with the current variables, the web still
calls Render directly and keeps tokens as before.

## This deployment

| | Value |
|---|---|
| Web origin | `https://life-portal-tan.vercel.app` |
| API origin | `https://life-portal.onrender.com` |
| Where Vercel forwards `/api` | `https://life-portal.onrender.com/api` (in `apps/web/vercel.json`) |
| Vercel Root Directory | `apps/web` |

Vercel reads `vercel.json` only from the project's **Root Directory**, which is `apps/web` here, so
the route that counts is `apps/web/vercel.json`. The repo-root `vercel.json` has the same route for
a project rooted at the repository; a test keeps the two identical. If the API's origin changes,
edit `dest` in both.

## 1. A shared secret

Generate one on your machine and keep it out of the repo, issues and chats:

```bash
openssl rand -hex 32
```

It only proves that a request came through Vercel, so the API can trust the visitor's address
for its per-IP sign-in limits.

## 2. Render (the API)

In the API service's **Environment**, add `WEB_PROXY_SECRET` = the secret, and redeploy. At least
32 characters, or the API refuses to boot and names the variable. `CORS_ORIGINS` stays as it is;
it must still list the web origin.

## 3. Vercel (the web app)

In the project's **Settings → Environment Variables** (Production), set:

| Variable | Value |
|---|---|
| `LP_PROXY_SECRET` | the same secret |
| `NEXT_PUBLIC_API_URL` | `/api` |
| `NEXT_PUBLIC_API_PUBLIC_URL` | `https://life-portal.onrender.com/api` |
| `API_INTERNAL_URL` | `https://life-portal.onrender.com/api` |

Then **redeploy**. `NEXT_PUBLIC_*` values are baked in at build time, so a redeploy is needed.

- `NEXT_PUBLIC_API_URL=/api` is the switch: the web reaches the API through Vercel and keeps its
  session in the cookie.
- `NEXT_PUBLIC_API_PUBLIC_URL` is what Settings → MCP and the Shortcut page show. Those clients
  keep calling Render directly.
- `API_INTERNAL_URL` is for link previews, which the web's server fetches.

## 4. Check it

1. Open `https://life-portal-tan.vercel.app/api/health`. It should say `"proxied": true` and
   `"proxy": "ok"`. Otherwise `proxy` names the step that failed, never a value:
   - `unconfigured`: Render has no `WEB_PROXY_SECRET` (or the API has not restarted since).
   - `no-header`: the request arrived without `x-lp-proxy`; the route's header transform did not
     run.
   - `unsubstituted`: Vercel sent the literal `$LP_PROXY_SECRET`, so the variable is missing for
     this environment, or the deployment predates it. Redeploy after setting it.
   - `mismatch`: both sides have a secret, but the values differ. Paste the same value into both,
     with no trailing space or newline.
   - `no-ip`: the secret matched but Vercel sent no valid `x-real-ip`.
   - The app's own page (the sign-in screen, or a page that says it was not found) means the
     route is not active and Next.js answered instead: `vercel.json` is not in the project's Root
     Directory (Settings → Build and Deployment), or the deployment predates it. Sign-in then
     says "Request failed".
2. Reload the app. You should still be signed in: the first refresh moves your stored session
   into the cookie.
3. In the browser's developer tools:
   - **Application → Local Storage** holds `lp.session` (your user id) and no `lp.accessToken`
     or `lp.refreshToken`.
   - **Cookies** show `lp_refresh` for the web origin, marked HttpOnly, Secure, Strict, path
     `/api/auth`.
4. On the iPhone, from the installed app, open it and reload: still signed in. Sign out and in
   again. Then turn on airplane mode and open the app: it opens as you, offline, as before.
5. Settings → MCP shows the `onrender.com` address, not `/api`.

## Rolling back

Set `NEXT_PUBLIC_API_URL` back to `https://life-portal.onrender.com/api` on Vercel and redeploy.
Everyone signs in once more, because the session was in the cookie, which the direct mode does not
use. `WEB_PROXY_SECRET` can stay.

## Notes

- Each API call takes one more hop: the browser to Vercel's nearest edge (Paris here), then to
  Render (Frankfurt). Same-origin calls also skip the CORS preflight, and the browser reuses its
  connection to the web origin.
- Photos and videos still go straight from the browser to storage (R2), not through Vercel.
- Proxied traffic counts toward Vercel's bandwidth.
