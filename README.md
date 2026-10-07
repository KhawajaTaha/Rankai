# AI Local SEO Autopilot

A multi-tenant agency platform for Local SEO automation. It combines Google Business Profile management, website SEO, AI content and images, rank tracking, a support CRM, approvals, reporting and a workflow engine.

> **Connect once → Analyze → Plan → Generate → Optimize → Publish → Monitor → Improve → Report**

Routine SEO work runs automatically. People are only pulled in when an action is risky, needs client approval, depends on unclear business information, can't be fixed safely, needs a human conversation, or fails.

---

## Quick start

```bash
cp .env.example .env            # fill ENCRYPTION_KEY + SESSION_SECRET (commands are in the file)
npm install
npx prisma db push              # create the schema (PostgreSQL 14+)
npm run db:seed                 # demo agency, team, clients, data
npm run dev                     # app + in-process background worker on http://localhost:3000
```

Demo accounts all use the password `Autopilot!2026` (override it with `SEED_PASSWORD`):

| Account | Experience |
|---|---|
| `admin@northpeak.example` | Agency Admin / Super Admin |
| `seo.manager@northpeak.example` | SEO Manager |
| `priya@northpeak.example` | SEO Specialist (assigned clients only) |
| `content@northpeak.example` | Content Manager |
| `support.manager@northpeak.example` | Support Manager |
| `maya@northpeak.example`, `daniel@northpeak.example` | Support Agents (simplified dashboard, assigned clients only) |
| `readonly@northpeak.example` | Read Only |
| `owner@superiorcustomgranite.example` | Client Owner (client portal) |
| `staff@superiorcustomgranite.example` | Client Staff (restricted portal) |

**Production:** run `npm run build && npm start` with `RUN_WORKER_IN_PROCESS=false`. Then run one or more `npm run worker` processes. `docker compose up` starts Postgres, the app and two workers. On serverless hosts, call `POST /api/cron` every minute with `Authorization: Bearer $CRON_SECRET`.

### Live vs Demo mode

Every integration is a real service layer. Each one has connection state, encrypted credentials, OAuth, sync jobs, retries, last sync, reconnect/disconnect and logging. When an integration has no credentials, it runs in **Demo Mode** with realistic, deterministic mock data. Demo Mode is always shown with a `DEMO MODE` badge in the UI and in `/api/health`.

| Integration | Live when | Implementation |
|---|---|---|
| AI (content, strategy, reports, assistants) | `ANTHROPIC_API_KEY` | Claude (`claude-opus-5-5` by default) with structured JSON outputs validated by zod, server-side refusal fallbacks enabled |
| Google Business Profile, Search Console, GA4 | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | OAuth with PKCE and hashed state. Tokens are AES-256-GCM encrypted and auto-refreshed. A connection that loses auth is marked expired, raises an alert and creates reconnect tasks |
| AI images | `IMAGE_PROVIDER=openai` + `IMAGE_API_KEY` | Image generation API, wrapped by the platform's safety, quality and brand checks |
| Rank tracking / map grid | `SERP_PROVIDER=dataforseo` + login | Google organic + Maps positions, including per-grid-point coordinates |
| WordPress | the connector plugin with a shared secret | HMAC-signed REST API (see `wordpress-plugin/`) |
| Email | `SMTP_URL` | nodemailer |

---

## Architecture

```
Next.js 15 (App Router, Server Components, Server Actions)  ─┐
PostgreSQL + Prisma (multi-tenant schema, ~60 models)         ├─ one codebase
Background worker (Postgres queue, FOR UPDATE SKIP LOCKED)   ─┘
```

```
src/
  app/(app)/…          agency + support-agent experience (role-aware sidebar)
  app/portal/…         client portal
  app/actions/…        server actions (permission-guarded, zod-validated, tenant-checked)
  app/api/…            OAuth callback, authorized file serving, health, cron
  lib/auth.ts          sessions (hashed tokens, httpOnly cookies), optional TOTP 2FA
  lib/permissions.ts   granular permission catalog + system roles
  lib/tenancy.ts       strict tenant & assignment scoping for every query
  lib/engine/          risk engine, recommendations/approvals, executor, rollback
  lib/ai/              Claude client, client "Business Brain", generators, claim safety
  lib/images/          image selection workflow, safety screening, providers
  lib/integrations/    Google OAuth/GBP/GSC/GA4, WordPress client, crawler, SERP
  lib/services/        onboarding, support CRM, GBP sync/audit, reviews, content,
                       website SEO, rankings, strategy, reports, watchdog, assistants
  lib/jobs/            queue, handlers registry, scheduler (daily/weekly/monthly), runner
  lib/scoring/         GBP score, website SEO score, client health
  worker/index.ts      standalone worker entry
wordpress-plugin/      Local SEO Autopilot Connector (PHP)
prisma/                schema + seed
tests/                 vitest suite (risk engine, scoring, safety, crypto, tenancy)
```

### AI execution pipeline (no unrestricted AI actions)

```
AI analysis → structured recommendation (action, target, reason, evidence, risk, confidence)
  → validation (action must be in the catalog)          lib/engine/risk.ts ACTIONS
  → risk class: AUTO-SAFE / APPROVAL REQUIRED / PROTECTED
  → client consent check (per-action consent keys)
  → automation level (Monitor / Assist / Approval Autopilot / Full Safe Autopilot)
  → confidence threshold (agency-configurable, default 80%)
  → change cooldown (observation window after major changes)
  → content claim safety (guarantees, medical/legal claims, prices, avoided words)
  → AUTO: queued execution | APPROVAL: Approval Center | MANUAL: task | MONITOR: logged
  → executor: backup snapshot → apply via integration → before/after record → verify
  → audit log + activity timeline → feedback measurement 14 days later
```

PROTECTED actions are never automated. They always become manual tasks. These include deleting pages, changing the domain, changing business identity or address, and mass rewrites. Changing the primary GBP category always needs approval.

### Background automation

The scheduler runs every 5 minutes. Dedupe keys make sure each daily, weekly and monthly flow runs exactly once per client and period:

* **Daily:** GBP sync (connection, reviews, posts, metrics, unauthorized-change detection), website health checks (uptime, SSL, robots.txt, speed), content generation for upcoming slots, health score, follow-up reminders and escalation, and the no-work-forgotten watchdog.
* **Weekly:** rankings, map grid, Search Console opportunities, GA4, content calendar planning, competitor review, AI weekly strategy, and the weekly report.
* **Monthly:** full website audit, full GBP audit, and the monthly report.

Failed jobs retry with exponential backoff. If the retries run out, the run is marked **Requires Human**, a task is created, the client's team is notified, and a critical alert is raised for publishing and execution failures. Runs can be retried or cancelled from **Automations → Execution History**.

### Tenancy & security

* Every tenant row carries `organizationId`, `clientId`, and `locationId` where a GBP location applies. All reads go through `clientWhere` / `clientScopeFilter` / `assertClientAccess`.
* Staff without `view_all_clients` see only the clients they're assigned to. Portal users see only their own client. Uploaded files are served through an authorized route, never as static files.
* Permission checks always test a permission key, never a role name. Members can be granted or revoked individual permissions.
* OAuth and API credentials are AES-256-GCM encrypted at rest and never sent to the browser.
* Sessions use hashed tokens with httpOnly, SameSite cookies. Login is rate limited per IP and per email (backed by Postgres) and compares passwords in constant time. Optional TOTP 2FA is supported.
* Server Actions are protected by Next's Origin check (CSRF). OAuth uses hashed, single-use state plus PKCE. WordPress requests use HMAC signatures with timestamps and replay protection.
* Security headers are set: CSP, frame-ancestors none, nosniff and referrer policy. Uploaded SVGs are served with a sandboxing CSP.
* An immutable audit log records actor (human, AI, automation, system or client), old and new values, source, approval and run IDs, and IP.

---

## Feature map (spec → where)

| Area | Where |
|---|---|
| Roles, granular permissions, per-member overrides | `lib/permissions.ts`, **Team** |
| Support agent dashboard (assigned clients, health statuses, today's work) | `/dashboard` (support experience) |
| Guided client creation by support agents | `/clients/new` → `services/onboarding.ts` |
| Onboarding pipeline, auto-created tasks within SLA, checklist, "next action" | `/onboarding`, Client Overview |
| GBP connection: client OAuth **and** agency account assignment, duplicate prevention | `/settings/google-connections`, Client → GBP, Portal → Google Business |
| Client 360° view, persistent header, quick actions, tabs | `/clients/[id]/…` |
| AI Business Brain plus auto-updates from notes, requests and GBP/website syncs | Client → Settings → AI Business Brain |
| GBP dashboard, score, recommendations, unauthorized-change alerts | Client → GBP |
| Automation levels, consent, package-driven settings | Client → Automations |
| GBP post engine, AI images (real-photo first, safety, quality, brand), media library, brand kit | `services/content.ts`, `images/`, Client → Content |
| Content calendar (month/week/list, drag to reschedule), content memory | `/content`, Client → Content |
| Review automation, negative-review workflow | `services/reviews.ts`, `/reviews` |
| Website crawler, SEO score, safe fixes, approvals for risky changes, before/after, backups, rollback | `services/website.ts`, `engine/executor.ts`, Client → Website SEO |
| WordPress / Elementor connector | `wordpress-plugin/` |
| AI blog engine (full SEO package, FAQ and Article schema, featured image) | `ai/generators.ts` |
| Search Console opportunity engine, GA4 comparisons | Client → Website SEO → Search Console / Analytics |
| Keyword tracking, local map grid heatmap, competitor gaps | Client → Rankings, `/rankings` |
| Support CRM: calls, notes (AI context, pinning, visibility), follow-up automation and escalation, requests with SLA, performance | `/support/*`, Client → Support |
| Task engine (sources, dependencies, statuses, comments, @mentions) | `/tasks` |
| Watchdog / clients at risk, weekly AI strategy, feedback loop, cooldowns, confidence | `services/watchdog.ts`, `services/strategy.ts` |
| Approval Center (edit, schedule, approve all safe) and client approval experience | `/approvals`, `/portal/approvals` |
| Bulk operations (no bulk identity edits), templates, packages | `/clients` bulk bar, `/settings` |
| Client health score, smart alerts (grouping and escalation), notifications, mentions | `/alerts`, `/notifications` |
| Activity timeline, reports with plain-English AI summary, auto delivery, white label, print/PDF | Client → Activity / Reports, `/reports` |
| Client portal | `/portal/*` |
| Command Center, execution history, automation success/ROI | `/automations` |
| Client AI assistant and agency AI assistant | Client Overview, `/assistant` |
| Global search, files with permissions, offboarding, audit log | top bar, Client → Files / Settings, `/audit-log` |

**Planned (Phase 5):** GoHighLevel, Twilio call automation, email inbox sync, billing and reseller. The integration layer and Integrations page are ready for them.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server and in-process worker |
| `npm run worker` | Standalone worker (production) |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | vitest suite. Set `DATABASE_URL` to include the tenancy tests that run against the seeded DB |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:seed` | Seed the demo agency (skipped when data already exists) |
| `npm run db:reset` | Drop and recreate the schema, then reseed (development only) |
