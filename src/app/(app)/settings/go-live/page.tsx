import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleAlert, CircleDashed, Rocket } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { env, modes } from "@/lib/env";
import { messagingLive } from "@/lib/messaging";
import { BRAND } from "@/lib/brand";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Go live" };

type Item = {
  key: string;
  name: string;
  need: "Required" | "Recommended" | "Optional";
  ok: boolean;
  does: string;
  cheapest: string;
  cost: string;
  env: string[];
  steps: string[];
};

export default async function GoLivePage() {
  const ctx = await requireStaff();
  if (!ctx.can("manage_integrations") && !ctx.can("manage_settings")) redirect("/settings");
  const [wpCount, alerts] = await Promise.all([
    db.integration.count({ where: { organizationId: ctx.orgId, kind: "WEBSITE_WORDPRESS", mode: "LIVE", status: "CONNECTED" } }).catch(() => 0),
    db.alert.findMany({ where: { organizationId: ctx.orgId, type: "integration_not_configured", status: { not: "RESOLVED" } }, select: { title: true } }).catch(() => []),
  ]);
  const https = env.appUrl.startsWith("https://");
  const secrets = Boolean(process.env.ENCRYPTION_KEY && process.env.SESSION_SECRET);

  const core: Item[] = [
    { key: "mode", name: "Live mode", need: "Required", ok: env.live, does: "Turns off every demo/mock fallback. Nothing fake is generated, shown or published.", cheapest: "—", cost: "Free", env: ["APP_MODE=live"], steps: ["Set APP_MODE=live in .env", "Restart the app and the worker"] },
    { key: "secrets", name: "Security keys", need: "Required", ok: secrets, does: "Encrypts Google/WordPress tokens at rest and signs login sessions.", cheapest: "Generate locally", cost: "Free", env: ["ENCRYPTION_KEY", "SESSION_SECRET", "CRON_SECRET"], steps: ["Run: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"", "Paste a different value into each variable. Never change ENCRYPTION_KEY after going live."] },
    { key: "url", name: "Domain + HTTPS", need: "Required", ok: https, does: "Google OAuth only accepts HTTPS redirect URLs in production; clients open the portal here.", cheapest: "Any domain + Caddy (free automatic HTTPS)", cost: "≈ $10 / year domain", env: ["APP_URL=https://seo.yourdomain.com"], steps: ["Point an A record (e.g. seo.yourdomain.com) to your server IP", "Use the bundled Caddyfile / docker-compose.prod.yml — HTTPS certificate is automatic"] },
    { key: "host", name: "Server + database", need: "Required", ok: env.isProd, does: "Runs the web app, the background worker (autopilot) and PostgreSQL.", cheapest: "1 small VPS (2 GB RAM) running Docker — app, worker and Postgres together", cost: "≈ $5–7 / month (Hetzner, Contabo, DigitalOcean)", env: ["DATABASE_URL", "RUN_WORKER_IN_PROCESS=false"], steps: ["Install Docker on the VPS", "docker compose -f docker-compose.prod.yml up -d", "docker compose exec app npm run setup:live (creates your admin account)"] },
  ];

  const integrations: Item[] = [
    { key: "ai", name: "AI — Anthropic Claude", need: "Required", ok: modes.aiLive(), does: "Writes GBP posts, blogs, review replies, SEO fixes, weekly strategy, report summaries and powers both assistants.", cheapest: "claude-haiku-5-5 for routine work (set AI_MODEL)", cost: "Pay-as-you-go. Haiku 5.5: $0.10 in / $0.50 out per million tokens — typically well under $1 per client per month. Opus 5.5 ($4 / $20) gives the best writing.", env: ["ANTHROPIC_API_KEY", "AI_MODEL (optional)", "AI_EFFORT (optional)"], steps: ["Create an account at console.anthropic.com", "Billing → add $5–10 credit", "API Keys → Create key → paste into ANTHROPIC_API_KEY"] },
    { key: "google", name: "Google — Business Profile, Search Console, GA4", need: "Required", ok: modes.googleLive(), does: "Connects client GBP listings (posts, reviews, replies, insights), Search Console queries and GA4 traffic.", cheapest: "Google Cloud project (free)", cost: "Free", env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], steps: ["console.cloud.google.com → new project", "Enable: My Business Account Management, My Business Business Information, Business Profile Performance, Google My Business API, Search Console API, Google Analytics Data API", "OAuth consent screen → External → add scopes; publish the app", "Credentials → OAuth client (Web) → redirect URI: " + env.appUrl + "/api/oauth/google/callback", "Request Business Profile API access (Google form, approval takes a few days)"] },
    { key: "serp", name: "Rank tracking + map grid — DataForSEO", need: "Recommended", ok: modes.serpLive(), does: "Weekly keyword positions and the local map grid heatmap.", cheapest: "DataForSEO standard (queued) SERP API", cost: "Pay-as-you-go, ≈ $0.0006 per keyword check; $50 minimum top-up lasts a long time for a small agency", env: ["SERP_PROVIDER=dataforseo", "SERP_API_LOGIN", "SERP_API_PASSWORD"], steps: ["Sign up at dataforseo.com", "Copy the API login + password from the dashboard"] },
    { key: "smtp", name: "Email (reports, invites, alerts)", need: "Recommended", ok: Boolean(env.smtpUrl), does: "Sends report emails, team invites, password resets and alert emails.", cheapest: "Brevo (300 emails/day free) or Resend (3,000/month free)", cost: "Free tier", env: ["SMTP_URL=smtp://user:pass@smtp-relay.brevo.com:587", "EMAIL_FROM"], steps: ["Create a Brevo account and verify your sending domain (SPF/DKIM)", "SMTP & API → create SMTP key → build SMTP_URL"] },
    { key: "images", name: "AI images", need: "Optional", ok: modes.imagesLive(), does: "Creates post images when the client has no suitable real photo. Real client photos are always used first.", cheapest: "Skip it and upload real photos (free), or OpenAI images", cost: "≈ $0.01–0.04 per image", env: ["IMAGE_PROVIDER=openai", "IMAGE_API_KEY", "IMAGE_MODEL (optional)"], steps: ["platform.openai.com → API keys", "Add a small credit balance"] },
    { key: "wp", name: "WordPress connector", need: "Optional", ok: wpCount > 0, does: "Applies safe website SEO fixes (titles, meta, schema, alt text) and publishes blogs, with backups and rollback.", cheapest: "Bundled plugin (wordpress-plugin/)", cost: "Free", env: ["per client — no env vars"], steps: ["Zip the wordpress-plugin folder and install it on the client site", "Client → Website SEO → Connections → copy the shared secret into the plugin settings"] },
    { key: "twilio", name: "SMS / WhatsApp alerts", need: "Optional", ok: messagingLive(), does: "Sends critical alerts to phones. In-app and email alerts work without it.", cheapest: "Skip — use in-app + email", cost: "Twilio ≈ $0.008 per SMS", env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"], steps: ["twilio.com → buy a number", "Copy SID + auth token"] },
  ];

  const all = [...core, ...integrations];
  const required = all.filter((i) => i.need === "Required");
  const ready = required.every((i) => i.ok);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/settings" className="link">Settings</Link>}
        title="Go live"
        subtitle={`Everything ${BRAND.name} needs to run for real clients — status is read from the server configuration.`}
        actions={<Badge tone={env.live ? "green" : "amber"} dot>{env.live ? "LIVE MODE" : "DEMO MODE"}</Badge>}
      />

      <div className={`card mb-5 flex items-start gap-3 p-5 ${ready ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
        {ready ? <Rocket className="mt-0.5 h-5 w-5 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-5 w-5 text-amber-600" />}
        <div className="text-sm">
          <div className="font-semibold text-ink-900">{ready ? "Ready — the autopilot is running live." : `${required.filter((i) => !i.ok).length} required item(s) left before going live`}</div>
          <p className="mt-0.5 text-ink-600">Typical monthly running cost for a small agency (10–20 clients): server ≈ $6, AI ≈ $2–10, rank tracking ≈ $5, email free — roughly <b>$15–25 / month</b>.</p>
          {alerts.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{alerts.map((a, i) => <li key={i}>{a.title}</li>)}</ul>}
        </div>
      </div>

      <Card title="How the autopilot works once live" className="mb-5">
        <ol className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["1. Connect", "Client (or your team) connects Google Business Profile, website (WordPress plugin), Search Console and GA4 once."],
            ["2. Analyze", "The worker syncs GBP, crawls the site, checks rankings and builds each client's AI Business Brain."],
            ["3. Plan", "Every week AI writes a strategy and a content calendar; every month a full audit."],
            ["4. Generate", "Posts, blogs, review replies, images and SEO fixes are written automatically from real client data."],
            ["5. Optimize & publish", "Safe actions run automatically. Risky ones go to the Approval Center or client portal. Protected ones become tasks."],
            ["6. Monitor & report", "Daily health checks, alerts on problems, rollback for website changes, weekly/monthly reports emailed and downloadable as PDF/CSV."],
          ].map(([t, d]) => <li key={t} className="rounded-xl border border-ink-100 p-3"><div className="font-semibold text-ink-900">{t}</div><p className="mt-0.5 text-xs text-ink-600">{d}</p></li>)}
        </ol>
      </Card>

      <Section title="Server & security" items={core} />
      <Section title="Integrations" items={integrations} />

      <Card title="After everything is green" className="mt-5">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
          <li>Settings → Google Connections → connect your agency Google account (or ask clients to connect from their portal).</li>
          <li>Clients → New client → fill the guided wizard. The autopilot starts analysing within minutes.</li>
          <li>Set each client&apos;s automation level under Client → Automations (start with “Approval Autopilot”).</li>
          <li>Invite your team under Team, and the client under Client → Settings → Portal users.</li>
        </ol>
      </Card>
    </>
  );
}

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <Card title={title} className="mt-5" pad={false}>
      <ul className="divide-y divide-ink-100">
        {items.map((i) => (
          <li key={i.key} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {i.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : i.need === "Optional" ? <CircleDashed className="h-4 w-4 text-ink-400" /> : <CircleAlert className="h-4 w-4 text-amber-500" />}
                <span className="text-sm font-semibold text-ink-900">{i.name}</span>
                <Badge tone={i.need === "Required" ? "red" : i.need === "Recommended" ? "amber" : "gray"}>{i.need}</Badge>
                <Badge tone={i.ok ? "green" : "gray"}>{i.ok ? "Configured" : "Not configured"}</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-600">{i.does}</p>
              <div className="mt-2 text-xs"><span className="font-medium text-ink-800">Cheapest option:</span> <span className="text-ink-600">{i.cheapest}</span></div>
              <div className="text-xs"><span className="font-medium text-ink-800">Cost:</span> <span className="text-ink-600">{i.cost}</span></div>
            </div>
            <div className="text-xs">
              <div className="mb-1 flex flex-wrap gap-1">{i.env.map((e) => <code key={e} className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{e}</code>)}</div>
              <ol className="list-decimal space-y-0.5 pl-4 text-ink-600">{i.steps.map((s) => <li key={s} className="break-words">{s}</li>)}</ol>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
