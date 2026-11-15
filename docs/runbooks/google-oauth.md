# Runbook: Continue with Google (issue #28)

Google sign-in is off until the API has a Google OAuth client. With nothing configured,
`GET /api/auth/capabilities` says `google: false` and no Google button appears anywhere. How it
works is in `docs/modules/auth-and-dashboard.md` → "Continue with Google".

**The client secret goes in the API host's environment and nowhere else.** Not in the repo,
not in an issue or a chat, not in the web app's environment (`NEXT_PUBLIC_*` is public).

## What you need first

- **The API's public origin**, e.g. `https://life-portal-api.onrender.com`. This becomes
  `API_PUBLIC_URL`.
- **The web app's origin**, e.g. `https://life-portal.vercel.app`. This is `WEB_BASE_URL`,
  already set for email (#27).

The redirect URI is derived, never typed separately:
`${API_PUBLIC_URL}/api/auth/google/callback`.

### This deployment

Found from the repo's homepage, the API's CORS answer and `/api/health` on 2026-11-15:

| | Value |
|---|---|
| Web origin (`WEB_BASE_URL`) | `https://life-portal-tan.vercel.app` |
| API origin (`API_PUBLIC_URL`) | `https://life-portal.onrender.com` |
| **Authorized redirect URI** | `https://life-portal.onrender.com/api/auth/google/callback` |
| Authorized domains | `vercel.app`, `onrender.com` |

If either origin changes (a custom domain), update the variable and the redirect URI together.

## 1. Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that should own
   the app.
2. Use the project picker at the top → **New project**. Name it (for example "Life Portal") →
   **Create**, then select it.

## 2. Google Auth Platform (consent screen)

In the console menu: **APIs & Services → OAuth consent screen**. Newer consoles call this
**Google Auth Platform**. If it offers **Get started**, click it.

1. **Branding / App information**
   - App name: `Life Portal`.
   - User support email: your address.
   - Optionally add a logo. A logo means Google reviews the branding before it is shown.
   - **Authorized domains**: add the registrable domain of the web app and of the API, for
     example `vercel.app` and `onrender.com`, or your own domain if you use one.
   - Developer contact email: your address.
2. **Audience**: **External**.
   - While the app is in **Testing**, only the addresses under **Test users** can sign in, at
     most 100. Add yours and anyone you invite.
   - Testing-mode consent also expires after 7 days, so you'll be asked again.
   - To open it to everyone, click **Publish app**. With only the scopes below no verification
     review is needed.
3. **Data access / Scopes**: add `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`. Nothing else; the app asks for no other scope.

## 3. OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID** (or **Google Auth
Platform → Clients → Create client**).

1. Application type: **Web application**. Name: `Life Portal API`.
2. **Authorized JavaScript origins**: leave empty. The browser never talks to Google directly;
   the API does.
3. **Authorized redirect URIs**: add exactly
   `https://<your API origin>/api/auth/google/callback`. It must match character for
   character: scheme, host, no trailing slash. For local development you can add a second one,
   `http://localhost:3333/api/auth/google/callback`.
4. **Create**. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client
   secret**. Newer consoles show the secret only once; if you lose it, add a new secret on the
   client and delete the old one.

## 4. Configure the API (Render)

In the API service's **Environment** settings, add:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the client ID |
| `GOOGLE_CLIENT_SECRET` | the client secret (mark it secret) |
| `API_PUBLIC_URL` | the API origin, `https://…`, no path, no trailing slash |
| `WEB_BASE_URL` | the web origin (already set for email) |

Then redeploy. All of the Google values must be set, or none. A partial or wrong setup stops
the API at boot with a message naming the variable, for example a non-HTTPS `API_PUBLIC_URL`
or a client ID that is not a Google one.

The web app (Vercel) needs **no** new variable. It learns that Google is on from
`/api/auth/capabilities`.

## 5. Check it for real

1. `GET https://<api>/api/auth/capabilities` returns `"google": true`.
2. On the sign-in page, a "Continue with Google" button appears. Use it with a test-user
   account and it should come back signed in.
3. With an account that already has a password and the same email as your Google account, you
   are asked for that password once, and then Google works for it.
4. **Settings → Sign-in & security → Google** shows the linked address. Unlink, then Link again.
5. On the iPhone, **from the installed app**: tap Continue with Google, choose the account, and
   you should land back in the app, signed in. If it lands in Safari instead, it fails with
   "took too long or was already used". Nothing is signed in there, and starting again from the
   app works. Report it if it happens every time.

## Locally

Use the same client with the `http://localhost:3333/api/auth/google/callback` redirect URI and,
in `.env`:

```bash
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
API_PUBLIC_URL=http://localhost:3333
WEB_BASE_URL=http://localhost:4200
```

The integration suite never talks to Google. `integration/google-signin.integration.ts` runs a
fake Google that signs real RS256 tokens, selected with `GOOGLE_OIDC_TEST_BASE`. Config refuses
that variable anywhere but loopback.

## Turning it off

Remove `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `API_PUBLIC_URL`, then redeploy. The
button disappears and Google sign-in stops. A Google-only account then signs in after setting a
password through "Forgot password?", which needs email (`docs/runbooks/email.md`). Linked
identities stay in `user_identities`, so turning Google back on restores them.

Rotating the secret means adding a new secret on the client, updating `GOOGLE_CLIENT_SECRET`,
redeploying, and then deleting the old secret.
