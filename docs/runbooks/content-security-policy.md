# Runbook: the Content-Security-Policy (issue #33)

The web app sends a Content-Security-Policy on every page. **It ships in report-only mode**: the
browser reports what the policy would have blocked (in its developer console) and blocks
nothing. Enforcement is a separate, later switch, made only after the checks below pass on real
devices.

Code: `apps/web/src/lib/csp.ts` (the policy, pure and tested) and `apps/web/src/proxy.ts` (a nonce
per request, the header on each page). The root layout puts the nonce on its theme script.

## The policy

```
default-src 'self'
script-src 'self' 'nonce-<per request>' 'strict-dynamic'      (+ 'unsafe-eval' in development only)
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob: <storage origin>
media-src 'self' blob: <storage origin>
font-src 'self' data:
connect-src 'self' <API origin, when it is another site> <storage origin>   (+ ws: in development)
worker-src 'self'; manifest-src 'self'
object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
```

There is **no report endpoint** on purpose: a report carries the page's URL and the blocked URL,
and a blocked URL can be a signed storage link. Violations are read in the browser's console.

## Deployment variables (Vercel, the web project)

| Variable | Value | When it is read |
|---|---|---|
| `NEXT_PUBLIC_STORAGE_ORIGIN` | The R2 endpoint's origin, the same value as the API's `R2_ENDPOINT`: `https://<account id>.r2.cloudflarestorage.com` | At build time: redeploy after changing it |
| `CSP_ENFORCE` | Unset (report-only). `true` enforces. | At run time |

`NEXT_PUBLIC_STORAGE_ORIGIN` must be exactly an origin: `https://host[:port]`, no path, query,
wildcard or credentials (plain `http` only for `localhost`). Anything else is ignored, so photo
uploads and signed reads would be reported (and later blocked), never silently widened.
Without it, posts with photos are reported too; set it before enforcing.

Signed links are path-style (`<endpoint>/<bucket>/<key>`), so the endpoint's origin covers both the
browser's `PUT` uploads and the signed reads.

## Before enforcing

On the deployed app, with the developer console open (Safari: connect the iPhone to a Mac,
Develop menu; Chrome: DevTools), look for `[Report Only]` messages while doing each of:

1. Sign in with a password and with **Continue with Google**; sign out; reload while signed in.
2. **Post with a photo** (upload), open it, and open a post with a video (signed reads).
3. **Share image** of an own post (the canvas fetches the photo).
4. Settings → **Shortcut / spending tokens** page and the **MCP** page.
5. Installed **PWA**: open it, go offline, reopen it (the cached shell carries its own policy and
   matching nonce), log a set and a meal offline, come back online.
6. A push notification arrives and a tap opens the right page.

Apple Health and bank messages arrive from Shortcuts straight at the API; the policy does not
apply to them.

When all are clean, set `CSP_ENFORCE=true` on Vercel and redeploy. To roll back, unset it.

## Cost

A nonce must be new on every response, so **no page is static any more**: every page load is a
render by a Vercel function instead of a file from the CDN, and the HTML is `no-store`. Locally the
render takes about 4 ms against about 1.5 ms for a static file. On Vercel it adds function
invocations (one per page load, not per API call) and an occasional cold start. Built assets
(`/_next/static`), icons, the manifest and the service worker stay static. The installed app's
offline start is unchanged: the service worker serves its cached shell.

The alternative, a fixed list of script hashes (Next's experimental SRI), was tried in a
production build and does not work: Next writes each page's data as inline scripts that differ
per page and per build, and those get no hash. See `docs/DECISIONS.md`.
