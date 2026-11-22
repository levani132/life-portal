# Platforms and accounts

Every outside service the app depends on: what it is, why we have it, what it costs, and where
its settings live. Keep it current: **adding or dropping a service means editing this file in the
same change** (and, if it receives personal data, the privacy policy too).

**All accounts are under the owner's personal Gmail for now.** The address itself is not written
here, on purpose: this file is in the repository. Move them to an address on the domain (for
example `accounts@lifeportal.one`) before anyone else needs access, or when a company takes over.
No secret, key or password belongs in this file.

Last reviewed: 2026-11-22.

## Where the app runs

| Service | What it is | Why we have it | Plan | Set up in |
|---|---|---|---|---|
| **Vercel** | Web hosting | Serves the web app at `lifeportal.one` and forwards `/api` to the server | Hobby, free (does not allow commercial use: upgrade before charging money) | `apps/web/vercel.json`, `docs/runbooks/web-api-proxy.md` |
| **Vercel Domains** | Domain registrar and DNS | Owns `lifeportal.one` (and `life-portal.one`, if bought, as a redirect) and holds every DNS record | About $21 a year per domain, auto-renew on | Vercel → Domains |
| **Render** | Server hosting | Runs the API (`life-portal.onrender.com`, Frankfurt). All server settings and keys are in its Environment page | Free (sleeps when idle) | `render.yaml`, `.env.example` |
| **MongoDB Atlas** | Database | Every record the app stores | M0, free, 512 MB | `MONGODB_URI` on Render |
| **Cloudflare R2** | File storage | Photos and videos, private, read through expiring links | Free tier | `R2_*` on Render; the bucket's CORS rule lists the web addresses (`docs/modules/posts.md`) |
| **GitHub** | Code and checks | The repository, and the checks that run on every push | Free | `.github/workflows` |

## Email

| Service | What it is | Why we have it | Plan | Set up in |
|---|---|---|---|---|
| **Resend** | Sends email | Password resets, address confirmation, account-deleted and review notices, from `no-reply@lifeportal.one` | Free: 3,000 a month, 100 a day | `MAIL_PROVIDER`, `RESEND_API_KEY`, `MAIL_FROM` on Render; `docs/runbooks/email.md` |
| **ImprovMX** | Receives email | Forwards anything sent to `@lifeportal.one` (`support@`, `privacy@`, `hello@`) to the owner's inbox | Free | MX and SPF records in Vercel DNS |

## Signing in and safety

| Service | What it is | Why we have it | Plan | Set up in |
|---|---|---|---|---|
| **Google Cloud Console** | OAuth client | "Continue with Google" | Free | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` on Render; `docs/runbooks/google-oauth.md` |
| **OpenAI** | Moderation endpoint | Checks photos other people can see before they are shown. One restricted key that can only call moderation | Free endpoint | `IMAGE_CHECK_PROVIDER`, `OPENAI_API_KEY` on Render; `docs/modules/moderation.md` |

## Data sources

| Service | What it is | Why we have it | Plan | Set up in |
|---|---|---|---|---|
| **Open Food Facts** | Public food database | Barcode lookups. No account; it asks for a contact address in the request header | Free | `OFF_CONTACT_EMAIL` or `OFF_USER_AGENT` on Render |
| **Finnhub** | Share prices | Daily quotes for the owner's money modules | Free, 60 calls a minute | `FINNHUB_API_KEY` on Render |

## Working tools

| Service | What it is | Why we have it |
|---|---|---|
| **Claude** (Anthropic) | AI assistant | Builds the app (Claude Code), and connects to it as an assistant through the app's connector (`docs/modules/mcp.md`) |
| **Apple Shortcuts** | On the owner's iPhone | Sends Apple Health activity and bank messages to the app. No account of ours; set up per phone (`docs/APPLE_HEALTH_SETUP.md`) |

## No account, but worth knowing

- **Push notifications** go through Apple's and Google's push services with a key pair we made
  ourselves (`VAPID_*` on Render). Changing the pair signs every device out of notifications.
- **A keep-awake job** pings the server so the free Render plan does not sleep. Which service
  runs it is not recorded anywhere: **owner, add it to the table above.**

## Not yet, but expected

| Service | For | When |
|---|---|---|
| A payments provider | Paid features, promoted posts | Roadmap step 12 |
| A hash-matching service (PhotoDNA, Thorn Safer, or Cloudflare's scanner) | Matching known abuse images, which the photo check does not do | Before large-scale public photos |
| Zoho Mail or Google Workspace | Replying *from* `support@lifeportal.one` | When forwarding is not enough |
| EUIPO and Sakpatenti | Registering the trademark | Once the app shows its worth |
| A video service (Mux or Cloudflare Stream) | Video that plays everywhere | Roadmap step 14 |

## If the owner's Gmail is lost

Every service above would be locked with it. Until the accounts move to a domain address: keep
two-step sign-in on that Gmail, keep its recovery codes somewhere safe, and add a second owner or
recovery contact wherever a service offers one (Vercel, Render, Atlas, Cloudflare and GitHub do).
