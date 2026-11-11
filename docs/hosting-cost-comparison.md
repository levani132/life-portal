# Hosting cost comparison: one provider or a mix?

**Prices checked: 2026-11-11.** Every figure below is an estimate (constitution principle 6) and
carries its basis. Basis codes:

- **[API]** — Microsoft's public Azure Retail Prices API (`prices.azure.com`), West Europe,
  pay-as-you-go list price, queried 2026-11-11. The most reliable numbers in this doc.
- **[vendor]** — the vendor's own pricing or docs page, as returned by a web search on 2026-11-11.
- **[3rd]** — third-party pricing trackers and blogs dated 2026; vendors' own pages did not render
  the figure. Treat as ±20% and verify before buying.
- **[calc]** — my arithmetic on the rates above, with the assumption stated.

Excluded everywhere because they are the same on every provider: domain, email (Resend/Postmark),
Sentry, Finnhub, AI calls, Apple fees. VAT is excluded. USD unless marked €.

## What the app actually needs

Read from the code and `docs/ROADMAP.md`, not assumed:

| Need | Today | What it constrains |
|---|---|---|
| NestJS API, one process | Render free, Frankfurt | Runs three in-process `@Cron` jobs (FX 06:00, quotes 22:00, media clean-up hourly). **A host that scales to zero skips them**, which is why Render free is kept awake by an outside cron. Any serverless host needs one warm instance or an external scheduler. |
| Next.js 16 web app | Vercel Hobby | Server rendering. Vercel Hobby forbids commercial use, so launch means Vercel Pro or another host. |
| MongoDB (Mongoose 9) | Atlas M0 (512 MB) | Atlas runs in Azure, AWS and GCP regions, so it travels with any choice. Azure's own Mongo (DocumentDB) and AWS DocumentDB are compatible, not identical. |
| Private object storage, signed URLs | Cloudflare R2 | The API signs **S3-style** URLs against `R2_ENDPOINT`. S3, GCS (interop), DigitalOcean Spaces and Hetzner Object Storage drop in by changing the endpoint. **Azure Blob is not S3-compatible**: moving there means writing a SAS-based signer. Egress price matters for a photo app. |
| Web push | `web-push` with VAPID | Provider-free; works anywhere. |
| iOS PWA | — | Static shell and service worker; any host. |
| CI | GitHub Actions `check.yml`, `ubuntu-latest`, 20-min timeout | The repo is **public** (`levani132/life-portal`), which makes CI free on both GitHub and Azure. |

## Tiers used below

- **A — Test stage (now):** the owner and a few friends, under 1 GB of data, a few GB of photos.
  Downtime and cold starts acceptable; no backups promised.
- **B — Early launch:** up to ~1k users. Commercial use allowed, always-on API, database backups,
  ~10–20 GB of media, ~100–200 GB of media downloads a month.
- **C — A few thousand users (~3–5k monthly):** two API instances, a dedicated database tier,
  ~100 GB of media and **~1 TB of media downloads a month** (the line that separates the options).

## Unit prices used

| Item | Price | Basis |
|---|---|---|
| Azure Container Apps (consumption) | $0.000034 per active vCPU-s, $0.000004 per idle vCPU-s, $0.000004 per GiB-s, $0.56 per 1M requests. Free each month: 180k vCPU-s, 360k GiB-s, 2M requests | [API] rates; free grant [vendor] |
| Azure App Service Linux | B1 $0.018/h (≈ $13/mo), B2 $0.036/h (≈ $26/mo) | [API] |
| Azure DocumentDB (vCore Mongo, ex-Cosmos DB for MongoDB vCore) | Free tier: one 32 GB cluster per region, no backups, no HA. Burstable 1 vCore $0.0249/h (≈ $18/mo), Burstable 2 vCore "M25" $0.0996/h (≈ $73/mo), storage $0.137/GB-mo | [API] rates; free tier [vendor] |
| Azure Blob Hot LRS | $0.018–0.0196/GB-mo; internet egress first 100 GB free, then $0.087/GB (Microsoft network routing) | [API] |
| Azure Container Registry Basic | $0.1666/day (≈ $5/mo) — avoidable with GitHub's free registry | [API] |
| Azure Static Web Apps Standard | ≈ $9/app/mo per environment; Next.js hybrid support unconfirmed | [3rd] |
| Azure DevOps Basic | first 5 users free, then $6/user/mo (Repos + Boards + Pipelines) | [vendor] |
| Azure Pipelines hosted CI | Private project: 1 parallel job, 60 min per run, 1,800 min/mo. Public project: 10 jobs, unlimited minutes. **In 2026 the free grant must be requested by form and is not automatic** | [vendor] (Microsoft Learn + 2026 Q&A) |
| GitHub Actions | Public repos: standard runners free and unlimited. Hosted-runner prices cut up to 39% on 2026-01-01; the planned self-hosted runner fee was postponed. Private free-plan quota (commonly 2,000 min/mo) not re-confirmed in this check | [vendor] |
| MongoDB Atlas | M0 free (512 MB). Flex $0.011/h base, capped ~$8–30/mo by ops/sec. M10 $0.08/h (≈ $57/mo). One tracker reports a March 2026 repackaging that drops Flex; unconfirmed | [3rd] mostly; M10 [vendor] |
| Render | Free (0.1 CPU, 512 MB, sleeps after 15 min, 750 h/mo). Starter $7 (0.5 CPU/512 MB), Standard $25 (1 CPU/2 GB), Pro $85. Workspace plans changed in April 2026; a paid workspace fee may apply | [vendor] for instances, [3rd] for workspace |
| Vercel | Hobby free, non-commercial only. Pro $20/mo with one deploying seat and $20 usage credit, 1 TB transfer included | [3rd], consistent across sources |
| Cloudflare R2 | Free: 10 GB, 1M writes, 10M reads a month. Then $0.015/GB-mo, $4.50/M writes, $0.36/M reads. **Egress free** | [vendor] |
| AWS Fargate | us-east-1 $0.04048/vCPU-h, $0.004445/GB-h; eu-west-1 ≈ $0.0456/vCPU-h. ALB ≈ $0.0225/h (≈ $16/mo) plus LCUs | [3rd] |
| AWS App Runner | Closed to new customers from 2026-04-30; AWS points to ECS Express Mode (Fargate + an ALB) | [3rd], multiple |
| AWS DocumentDB | Smallest instance ≈ $80–84/mo; serverless minimum 0.5 DCU ≈ $30/mo compute; no permanent free tier | [3rd] |
| AWS new accounts | Credit-based free plan since July 2025, up to $200 in credits | [3rd] (AWS Builder Center) |
| Google Cloud Run | Free: 2M requests, 180k vCPU-s, 360k GiB-s a month. $0.000024/vCPU-s, $0.0000025/GiB-s. One warm idle instance ≈ $7/mo | [vendor] rates; warm instance [3rd] |
| Hetzner Cloud | Two 2026 price rises (April, June). CX23 €5.49, CAX11 €5.99/mo ex-VAT and ex-IPv4; new CX/CAX orders intermittently unavailable Sept–Oct 2026 | [vendor] docs + [3rd] |
| DigitalOcean | App Platform from $5/container; managed MongoDB from ≈ $15/mo | [3rd] |
| Fly.io | shared-cpu-1x 256 MB $2.19/mo; RAM rose to ≈ $6/GB-mo in Oct 2026; no free compute allowance found | [vendor] + [3rd] |

## Tier A — test stage (now)

| Option | Web | API | Database | Media | Monthly | Notes |
|---|---|---|---|---|---|---|
| **Current mix** (Vercel + Render + Atlas + R2) | $0 | $0 | $0 (M0) | $0 | **$0** | Render sleeps without the keep-awake cron; M0 caps at 512 MB. |
| **All Azure** | Container App scaled to zero ≈ $0 | Container App, 0.25 vCPU/0.5 GiB, one warm replica ≈ $6 [calc] | DocumentDB free tier $0 | Blob ≈ $0 | **≈ $6–11** | +$5 if images go to Azure Container Registry instead of GitHub's. Needs a SAS signer for Blob, or keep R2. |
| **All AWS** | Amplify or Fargate | Fargate 0.25 vCPU + ALB ≈ $25 [calc] | Atlas M0 (on AWS) | S3 ≈ $0 | **≈ $0 for months on credits, then ≈ $25+** | The ALB alone is ≈ $16. A single Lightsail box is the cheap AWS path. |
| **Google Cloud** | Cloud Run, scale to zero ≈ $0 | Cloud Run, one warm instance ≈ $7 [3rd] | Atlas M0 (on GCP) | GCS ≈ $0 | **≈ $7** | |
| **Hetzner VPS** | Same box | CX23 + IPv4 ≈ €6 | Atlas M0 | R2 $0 | **≈ $7** | You run Docker, TLS, updates and restarts yourself. |

*[calc] for the Azure API: 2.59M s/month; idle vCPU 0.25 × 2.59M × $0.000004 ≈ $2.60; memory
(0.5 × 2.59M − 360k free) × $0.000004 ≈ $3.70.*

**Verdict for A:** nothing beats $0. Moving now buys nothing but the move itself.

## Tier B — early launch (up to ~1k users)

| Option | Web | API | Database | Media | Monthly | Notes |
|---|---|---|---|---|---|---|
| **Current mix, upgraded** | Vercel Pro $20 | Render Starter $7 – Standard $25 | Atlas Flex $8–30 | R2 $0–1 | **≈ $35–75** (+ any Render workspace fee) | Matches the roadmap's $40–70. Zero migration. |
| **Azure-centred mix** (Container Apps + Atlas + R2) | Container App ≈ $0–5 | Container App 0.5 vCPU/1 GiB, one warm replica ≈ $14 [calc] | Atlas Flex $8–30 (Atlas in an Azure region, can be billed through Azure Marketplace) | R2 $0–1 | **≈ $25–50** | Cheaper than paying Vercel Pro. Keeps Mongo and the S3 signer unchanged. |
| **All Azure** | Container App ≈ $0–5 | ≈ $14 [calc] | DocumentDB Burstable 1 vCore ≈ $18 + 32 GB ≈ $4.40 [API] | Blob ≈ $0.50, egress within 100 GB free | **≈ $40–45** (+$5 ACR) | One bill. Needs Blob SAS signing and DocumentDB compatibility testing. |
| **All AWS** | Amplify or second Fargate task ≈ $10–20 | Fargate 0.5 vCPU/1 GB ≈ $20 + ALB ≈ $20 [calc] | Atlas Flex $8–30 (or DocumentDB ≈ $80) | S3 ≈ $1 | **≈ $60–90** (≈ $130+ with DocumentDB) | Most moving parts for the money. |
| **Google Cloud** | Cloud Run ≈ $0–5 | Cloud Run, one warm instance ≈ $7–20 | Atlas Flex $8–30 | GCS ≈ $1 | **≈ $16–55** | Close to Azure Container Apps in shape and price. |
| **Hetzner VPS** | Same box | CX23/CAX11 ≈ €6–7 | Atlas Flex $8–30 | R2 $0–1 | **≈ $15–40** | Cheapest cash; the most of your time. Price trend in 2026 is up. |

*[calc] for the Azure API at 10% active: idle vCPU 0.45 × 2.59M × $0.000004 ≈ $4.70; active
vCPU inside the free grant; memory (2.59M − 360k) × $0.000004 ≈ $8.90.*

## Tier C — a few thousand users

| Option | Web | API (×2) | Database | Media (100 GB, ~1 TB out) | Redis | Monthly |
|---|---|---|---|---|---|---|
| **Current mix** | Vercel Pro $20–40 | Render Standard ×2 $50 | Atlas M10 ≈ $57 (+ backup) | R2 ≈ $5 | Upstash $0–10 | **≈ $135–175** |
| **Azure-centred mix** | Container App $10–30 | Container Apps $50–110 [calc] | Atlas M10 ≈ $57 | R2 ≈ $5 | Upstash $0–10 | **≈ $125–210** |
| **All Azure** | Container App $10–30 | Container Apps $50–110 [calc] | DocumentDB M25 ≈ $73 + storage ≈ $4 [API] | Blob ≈ $2 + egress ≈ $80 [API calc] | Azure Redis (not priced) | **≈ $220–300** |
| **All AWS** | Fargate/Amplify $20–40 | Fargate ×2 $40 + ALB $20–25 | Atlas M10 ≈ $57 (DocumentDB ≈ $90+) | S3 + CloudFront ≈ $2–90 (depends on CloudFront's free allowance; unverified) | ElastiCache (not priced) | **≈ $140–250** |
| **Google Cloud** | Cloud Run $10–30 | Cloud Run $40–90 | Atlas M10 ≈ $57 | GCS egress ≈ $85–120 (rate unverified) | Memorystore (not priced) | **≈ $195–300** |
| **Hetzner VPS** | Same box | One 4–8 GB box ≈ €10–25 (post-June 2026 prices, unverified) | Atlas M10 ≈ $57 | R2 ≈ $5 | On the box | **≈ $75–95 + your time** |

*[calc] Container Apps API: two 0.5 vCPU / 1 GiB replicas, 30% active ≈ $47 after the free grant;
fully active ≈ $109. Blob egress: (1,024 − 100) GB × $0.087 ≈ $80.*

**The one line that decides Tier C is media egress.** R2 is $0 per GB downloaded; Azure Blob,
S3 and GCS charge $0.08–0.12 per GB, so a photo- and video-heavy social feed costs ≈ $80 more a
month per terabyte on any single big cloud. That gap grows linearly with video.

## CI/CD and the code host

| | GitHub (+ Actions, Issues/Projects) | Azure DevOps (Repos + Boards + Pipelines) |
|---|---|---|
| Price for this repo | Free. Public repo → unlimited standard-runner minutes | Free for 5 Basic users. Public project → 10 jobs, unlimited minutes, **after requesting the grant** |
| If the repo goes private | Free-plan minute quota (≈ 2,000/mo, not re-confirmed); overage minutes got cheaper in the January 2026 price cut | 1 job, **60 min per run**, 1,800 min/mo, after requesting the grant; then ≈ $40/mo per extra hosted job (not re-confirmed). The 60-minute cap is fine (`check` runs well under 20 min); 1,800 min is ~8 pushes a day at 7 min each — tight with bots pushing to main |
| Deploys to the current hosts | Native: Vercel and Render deploy on push to GitHub | **Vercel has no native Azure Repos integration** (Vercel's docs route it through an Azure Pipelines extension and require disconnecting Git). Render support for Azure Repos not found |
| Agent tooling | `gh`, Claude Code's PR status/auto-fix, `/code-review ultra`, Dependabot, CodeQL — all GitHub-native | Azure DevOps MCP server is already connected in this workspace (work items, WIQL, pipelines, repos) |
| Task board for a 15-minute watcher agent | Issues + Projects; queries through `gh`/GraphQL; fine but less structured | Boards is the stronger tracker: typed work items, states, WIQL queries, area/iteration paths |
| Lock-in | Low; Git moves anywhere | Repos low; Pipelines YAML is Azure-specific; Boards export is clumsy |

**Middle path that keeps most of the value:** keep the code on GitHub, use **Azure Boards** for the
task board (free for 5 users; it links to GitHub commits and PRs with `AB#123` mentions), and use
GitHub Actions for CI. You get Azure's board without breaking Vercel/Render deploys or Claude
Code's GitHub tooling. Azure Pipelines can also build a GitHub-hosted repo if you later want it.

## Lock-in and migration effort

| Move | Effort | What changes |
|---|---|---|
| API → Azure Container Apps / Cloud Run / Fargate | 1–2 days | A Dockerfile, registry, env vars, health probe, `PORT` handling (already supported), one warm replica so the `@Cron` jobs run. Low lock-in: it is a container. |
| Web → Container Apps / Cloud Run | 1 day | `next start` in a container, or `output: 'standalone'`. Loses Vercel's preview deploys and edge caching unless rebuilt. |
| Web → Azure Static Web Apps | Unknown | Next.js 16 hybrid rendering support unconfirmed; not recommended. |
| Atlas → Atlas in another cloud's region | Hours | Atlas can move a cluster between cloud providers live. No code change. |
| Atlas → Azure DocumentDB / AWS DocumentDB | Days to weeks | Compatible, not identical: test every aggregation, index, transaction and the Mongoose 9 driver against it. Hard to reverse once data lives there. **Highest lock-in item in this doc.** |
| R2 → S3 / GCS / Spaces / Hetzner | Hours | Change `R2_ENDPOINT`/keys and copy objects. CORS rules and the signed-type/size checks must be retested. |
| R2 → Azure Blob | 2–4 days | New signer (SAS), new upload flow test on iOS, CORS, copy objects. Then pay egress. |
| GitHub → Azure Repos + Pipelines | 1–2 days, ongoing friction | Port `check.yml`, request the free grant, rewire Vercel/Render deploys through Pipelines, lose GitHub-native tooling. |

## One provider vs a mix

**One provider is not cheaper at any of these tiers.** Free tiers stack across providers (Vercel's,
Render's, Atlas's and R2's together cover today at $0); one provider gives you one set. At Tier C the
single-cloud options are dearer mainly because of egress and their own Mongo-compatible databases.

**One provider is simpler in exactly two ways:** one bill and one identity/console. Both are
partly available without moving: Atlas can be bought through the Azure Marketplace and land on the
Azure bill, and Azure Boards can sit beside GitHub.

**A mix is simpler where it counts for this codebase:** every dependency is already portable
(containers, a Mongo URI, an S3 endpoint, VAPID push). The mix's real costs are four dashboards,
four sets of credentials, and cross-provider latency — keep the API and Atlas in the same region
(Frankfurt today, or Azure West Europe/Germany West Central if the API moves) and the latency cost
disappears.

## Recommendation

1. **Now (Tier A): change nothing.** $0 is unbeatable and the project is a test environment.
2. **Code host: stay on GitHub.** Free unlimited CI for a public repo, native deploys to the
   current hosts, and Claude Code's tooling. If you want Azure's board for the watcher agent, use
   **Azure Boards linked to the GitHub repo** rather than moving the repo to Azure Repos.
3. **At launch (Tier B), if you want Azure:** take the **Azure-centred mix** — API and web on Azure
   Container Apps (one warm API replica for the cron jobs), **Atlas in an Azure region** (billed via
   the Azure Marketplace if one bill matters), and **keep R2** for media. ≈ $25–50/month, cheaper than
   the upgraded current mix (≈ $35–75, because Vercel Pro is required for commercial use), with about
   two days of work and no data-layer change.
4. **Don't move Mongo to Azure DocumentDB or media to Blob** unless a requirement forces it (data
   residency, an enterprise customer, Azure credits). They are the two moves that cost real
   engineering time, add lock-in and, for Blob, raise the bill as video grows.
5. **Re-check prices before buying.** Hetzner and Fly raised prices twice in 2026, Render and
   possibly Atlas repackaged plans, and AWS closed App Runner to new customers. The [3rd] figures
   above are the ones most likely to have moved.

## Sources (checked 2026-11-11)

- Azure Retail Prices API: `https://prices.azure.com/api/retail/prices` (Container Apps, App Service, DocumentDB, Blob, Bandwidth, Container Registry; West Europe)
- [Azure Container Apps pricing](https://azure.microsoft.com/pricing/details/container-apps/)
- [Azure DocumentDB free tier](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/free-tier) and [burstable tier](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/burstable-tier)
- [Azure Pipelines parallel jobs](https://learn.microsoft.com/azure/devops/pipelines/licensing/concurrent-jobs) and [2026 Q&A on the free grant needing a request](https://learn.microsoft.com/en-us/answers/questions/5815884/microsoft-hosted-parallel)
- [Azure DevOps pricing](https://azure.microsoft.com/en-us/pricing/details/devops/azure-devops-services/)
- [Azure Static Web Apps pricing](https://azure.microsoft.com/pricing/details/app-service/static/)
- [GitHub Actions 2026 pricing changes](https://resources.github.com/actions/2026-pricing-changes-for-github-actions/) and [changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)
- [Vercel for Azure Pipelines](https://vercel.com/docs/git/vercel-for-azure-pipelines)
- [Vercel pricing overview (3rd)](https://temps.sh/blog/vercel-pricing-complete-guide-2026.md)
- [Render pricing](https://render.com/pricing.md)
- [MongoDB pricing](https://www.mongodb.com/pricing.md) and [Atlas Flex pricing model (3rd)](https://oneuptime.com/blog/post/2026-03-31-mongodb-atlas-flex-cluster-pricing-model/view)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/index.md)
- [AWS Fargate pricing (3rd)](https://cloudburn.io/blog/aws-fargate-pricing), [App Runner end of new sign-ups (3rd)](https://encore.dev/articles/end-of-app-runner), [DocumentDB pricing](https://aws.amazon.com/documentdb/pricing/), [AWS 2026 free plan](https://builder.aws.com/content/3Kkt4kNiDSUnO3n6db2weSNubzE/the-dollar0-aws-account-in-2026-free-plan-credits-guardrails)
- [Google Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) and [2026 rises (3rd)](https://northflank.com/blog/hetzner-cloud-server-price-increases)
- [Fly.io pricing](https://fly.io/docs/about/pricing/)
- [DigitalOcean pricing (3rd)](https://www.activepieces.com/blog/digitalocean-pricing-plans-and-real-costs-in-2026)
