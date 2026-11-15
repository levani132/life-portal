# Email delivery (password reset, email verification)

Issue #27. The API sends email for two things only: password-reset links and email-verification
links. Until it is configured, both are **off**:
- `GET /api/auth/capabilities` answers `false` for both;
- the sign-in page shows no "Forgot password?" link;
- `POST /api/auth/forgot-password` answers 503 `RESET_UNAVAILABLE`.

Nothing pretends to send.

## What you need to provide

1. **A Resend account** (https://resend.com). The free tier covers a personal deployment.
2. **A domain you control** to send from, for example `mail.example.com` or the app's own domain.
3. **DNS access** for that domain, to add the records Resend shows you.

## Steps

1. In Resend, go to **Domains → Add domain** and enter the sending domain.
2. Add the DNS records Resend lists at your DNS host, usually:
   - an **SPF** `TXT` record (or an `MX` + `TXT` pair on a `send.` subdomain);
   - a **DKIM** `TXT` record (`resend._domainkey`);
   - optionally a **DMARC** `TXT` record on `_dmarc`, for example `v=DMARC1; p=none;`. It is
     recommended: some inboxes junk mail from domains without one.
3. Wait until Resend shows the domain as **Verified**. It can take from minutes to a few hours.
4. In Resend, go to **API Keys → Create API key**, with permission **Sending access**,
   restricted to that domain. Copy it once. It starts with `re_`.
5. In the API's environment on the host (Render → the API service → Environment), set:

   | Variable | Value |
   |---|---|
   | `WEB_BASE_URL` | the web app's HTTPS address, e.g. `https://portal.example.com` |
   | `MAIL_PROVIDER` | `resend` |
   | `RESEND_API_KEY` | the key from step 4 |
   | `MAIL_FROM` | `Life Portal <no-reply@your-verified-domain>` |

   Never commit these values. They belong in the host's secret settings only.
6. Redeploy the API. It refuses to boot if the values are inconsistent: a key without a provider,
   a provider without a key or sender, an HTTP `WEB_BASE_URL` outside localhost, or `dev`
   outside localhost.
7. **Check it for real:**
   1. Open `/forgot-password` and enter your own address.
   2. The email should arrive within a minute. If it lands in spam, check the DKIM and DMARC
      records.
   3. Click the link, set a password, and sign in with it.
   4. In Resend → **Emails**, the message shows as delivered.

Until step 7 has worked once, assume email does **not** work.

## Local development

Set `WEB_BASE_URL=http://localhost:4200` and `MAIL_PROVIDER=dev`. Messages are stored in the
`dev_mail` collection for a day instead of being sent; the API log says when one was stored, but
never prints the link. Read it with:

```bash
docker exec lp-mongo mongosh --quiet lp-dev --eval 'db.dev_mail.find().sort({createdAt:-1}).limit(1).toArray()'
```

The integration tests use the same sink (`integration/harness.ts`).

## Troubleshooting

- **The API log says `Could not send a reset link: Resend refused the message (HTTP 403)`.** The
  key lacks sending access, or `MAIL_FROM` is not on a verified domain.
- **HTTP 422.** `MAIL_FROM` is malformed.
- **The person always sees "If that email has an account, we've sent a link"**, even when sending
  failed. That is deliberate, so the page can't be used to learn which emails exist. Look for
  failures in the API log and in `security_events` (`type: 'password_reset_requested'`,
  `detail: 'send_failed'`).
