import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { ACTIONS } from "@/lib/engine/risk";
import { Badge, Card, EmptyState, StatusBadge, Tabs, timeAgo } from "@/components/ui";
import { ActionButton, ActionForm, Field, SubmitButton, Toggle } from "@/components/client";
import { changePackageAction, updateAutomationAction, updateConsentAction } from "@/app/actions/clients";
import { recommendationAction, runControlAction } from "@/app/actions/ops";
import { LEVEL_LABEL, pretty } from "@/lib/labels";

const SUB = ["settings", "consent", "recommendations", "history"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IMG_MODES = [["OFF", "Off"], ["DRAFT_ONLY", "Generate draft only"], ["REQUIRE_APPROVAL", "Generate + require approval"], ["AUTO_USE", "Generate + auto use"]];
const STYLES = ["Photo-realistic", "Professional", "Luxury", "Clean", "Modern", "Healthcare", "Automotive", "Home Services", "Corporate", "Travel"];

export default async function ClientAutomations({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const client = await getAccessibleClient(ctx, id);
  const tab = SUB.includes(sp.tab ?? "") ? sp.tab! : "settings";
  const base = `/clients/${id}/automations`;
  const [s, consent, packages, recs, runs] = await Promise.all([
    db.automationSetting.findUniqueOrThrow({ where: { clientId: id } }),
    db.clientConsent.findUniqueOrThrow({ where: { clientId: id } }),
    db.servicePackage.findMany({ where: { organizationId: ctx.orgId } }),
    db.aiRecommendation.findMany({ where: { clientId: id }, orderBy: [{ updatedAt: "desc" }], take: 100 }),
    db.automationRun.findMany({ where: { clientId: id }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const can = ctx.can("manage_automations");
  const sel = (name: string, value: string, options: string[][]) => <select name={name} defaultValue={value} className="input" disabled={!can}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;

  return (
    <div className="space-y-5">
      <Tabs active={`${base}?tab=${tab}`} tabs={SUB.map((t) => ({ href: `${base}?tab=${t}`, label: pretty(t), count: t === "recommendations" ? recs.filter((r) => r.status === "NEEDS_APPROVAL").length : undefined }))} />
      {tab === "settings" && (
        <ActionForm action={updateAutomationAction.bind(null, id)} resetOnSuccess={false} className="space-y-5">
          <Card title="Automation level" subtitle="Protected actions are always manual regardless of level">
            <div className="grid gap-3 md:grid-cols-4">
              {(["MONITOR_ONLY", "ASSIST", "APPROVAL_AUTOPILOT", "FULL_SAFE_AUTOPILOT"] as const).map((l) => (
                <label key={l} className="cursor-pointer rounded-xl border border-ink-200 p-3 text-sm has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50">
                  <input type="radio" name="level" value={l} defaultChecked={s.level === l} className="mr-2" disabled={!can} />
                  <span className="font-medium">{LEVEL_LABEL[l]}</span>
                  <p className="mt-1 text-xs text-ink-500">{{ MONITOR_ONLY: "System only detects issues.", ASSIST: "AI recommends, humans execute.", APPROVAL_AUTOPILOT: "Safe changes run automatically; risky ones need approval.", FULL_SAFE_AUTOPILOT: "All allowed low-risk automation runs automatically." }[l]}</p>
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label="Observation period after major changes (days)" hint="Cooldown before another major edit to the same asset"><input name="observationDays" type="number" min={3} max={90} defaultValue={s.observationDays ?? ""} placeholder="agency default" className="input" disabled={!can} /></Field>
            </div>
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="GBP posting">
              <Toggle name="gbpPostingEnabled" label="Enable GBP posting" defaultChecked={s.gbpPostingEnabled} disabled={!can} />
              <div className="my-2 grid grid-cols-2 gap-3">
                <Field label="Posts per week"><input name="postsPerWeek" type="number" min={0} max={7} defaultValue={s.postsPerWeek} className="input" disabled={!can} /></Field>
                <Field label="Preferred time"><input name="postTime" type="time" defaultValue={s.postTime} className="input" disabled={!can} /></Field>
              </div>
              <span className="label">Preferred days</span>
              <div className="mb-2 flex flex-wrap gap-1.5">{DAYS.map((d, i) => <label key={d} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-xs has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50"><input type="checkbox" name="postDays" value={i} defaultChecked={s.postDays.includes(i)} disabled={!can} />{d}</label>)}</div>
              <Toggle name="autoGenerateCopy" label="Auto generate copy" defaultChecked={s.autoGenerateCopy} disabled={!can} />
              <Toggle name="autoGenerateImage" label="Auto generate / select image" defaultChecked={s.autoGenerateImage} disabled={!can} />
              <Toggle name="postsRequireApproval" label="Require approval" defaultChecked={s.postsRequireApproval} disabled={!can} />
              <Toggle name="autoPublishPosts" label="Auto publish" description="Also requires client consent for auto-posting & auto-publishing" defaultChecked={s.autoPublishPosts} disabled={!can} />
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="Content categories"><input name="contentCategories" defaultValue={s.contentCategories.join(", ")} className="input" disabled={!can} /></Field>
                <Field label="CTA preference">{sel("ctaPreference", s.ctaPreference, [["CALL", "Call"], ["BOOK", "Book"], ["LEARN_MORE", "Learn more"], ["ORDER", "Order"], ["SIGN_UP", "Sign up"], ["GET_OFFER", "Get offer"]])}</Field>
              </div>
            </Card>
            <Card title="AI images" subtitle="Real approved photos are always preferred when available">
              <div className="grid grid-cols-2 gap-3">
                <Field label="GBP posts">{sel("aiImagesGbp", s.aiImagesGbp, IMG_MODES)}</Field>
                <Field label="Blogs">{sel("aiImagesBlog", s.aiImagesBlog, IMG_MODES)}</Field>
                <Field label="Social">{sel("aiImagesSocial", s.aiImagesSocial, IMG_MODES)}</Field>
                <Field label="Reports">{sel("aiImagesReports", s.aiImagesReports, IMG_MODES)}</Field>
                <Field label="Website images">{sel("aiImagesWebsite", s.aiImagesWebsite, IMG_MODES)}</Field>
                <Field label="Image style">{sel("imageStyle", s.imageStyle, STYLES.map((x) => [x, x]))}</Field>
                <Field label="Preferred dimensions"><input name="imageDimensions" defaultValue={s.imageDimensions} className="input" disabled={!can} /></Field>
              </div>
              <Toggle name="preferRealPhotos" label="Use business photos when available" defaultChecked={s.preferRealPhotos} disabled={!can} />
              <Toggle name="imageAddLogo" label="Add logo" defaultChecked={s.imageAddLogo} disabled={!can} />
              <Toggle name="imageAddText" label="Add text" defaultChecked={s.imageAddText} disabled={!can} />
            </Card>
            <Card title="Blogs">
              <Toggle name="blogsEnabled" label="Enable blogs" defaultChecked={s.blogsEnabled} disabled={!can} />
              <div className="my-2 grid grid-cols-2 gap-3">
                <Field label="Blogs per month"><input name="blogsPerMonth" type="number" min={0} max={30} defaultValue={s.blogsPerMonth} className="input" disabled={!can} /></Field>
                <Field label="Minimum words"><input name="blogMinWords" type="number" min={300} defaultValue={s.blogMinWords} className="input" disabled={!can} /></Field>
                <Field label="Preferred tone"><input name="blogTone" defaultValue={s.blogTone ?? ""} className="input" disabled={!can} /></Field>
                <Field label="Target services"><input name="blogTargetServices" defaultValue={s.blogTargetServices.join(", ")} className="input" disabled={!can} /></Field>
                <Field label="Target locations"><input name="blogTargetLocations" defaultValue={s.blogTargetLocations.join(", ")} className="input" disabled={!can} /></Field>
              </div>
              <span className="label">Blog days</span>
              <div className="mb-2 flex flex-wrap gap-1.5">{DAYS.map((d, i) => <label key={d} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-xs has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50"><input type="checkbox" name="blogDays" value={i} defaultChecked={s.blogDays.includes(i)} disabled={!can} />{d}</label>)}</div>
              <Toggle name="blogRequireApproval" label="Blog approval required" defaultChecked={s.blogRequireApproval} disabled={!can} />
              <Toggle name="blogAutoPublish" label="Auto publish" defaultChecked={s.blogAutoPublish} disabled={!can} />
              <Toggle name="blogFeaturedImage" label="AI featured image" defaultChecked={s.blogFeaturedImage} disabled={!can} />
            </Card>
            <Card title="Reviews, website, tracking & reports">
              <Field label="Review replies">{sel("reviewAutoReply", s.reviewAutoReply, [["AUTO_POSITIVE", "Auto reply to positive (per toggles below)"], ["APPROVAL_ALL", "Require approval for all"], ["NEVER", "Never auto reply"]])}</Field>
              <Toggle name="autoReply5" label="Auto reply to 5-star" defaultChecked={s.autoReply5} disabled={!can} />
              <Toggle name="autoReply4" label="Auto reply to 4-star" defaultChecked={s.autoReply4} disabled={!can} />
              <p className="mb-2 text-xs text-ink-500">1–3 star reviews always require approval and raise an alert.</p>
              <Toggle name="websiteSafeFixes" label="Website safe auto-fixes" description="Meta descriptions, alt text, internal links, schema, broken links" defaultChecked={s.websiteSafeFixes} disabled={!can} />
              <div className="my-2 grid grid-cols-2 gap-3">
                <Field label="Rank tracking">{sel("rankTracking", s.rankTracking, [["OFF", "Off"], ["WEEKLY", "Weekly"], ["DAILY", "Daily"]])}</Field>
                <Field label="Map grid">{sel("mapGrid", s.mapGrid, [["OFF", "Off"], ["WEEKLY", "Weekly"], ["MONTHLY", "Monthly"]])}</Field>
                <Field label="Grid size">{sel("gridSize", String(s.gridSize), [["3", "3×3"], ["5", "5×5"], ["7", "7×7"]])}</Field>
                <Field label="Grid radius (km)"><input name="gridRadiusKm" type="number" step="0.5" defaultValue={s.gridRadiusKm} className="input" disabled={!can} /></Field>
                <Field label="Report day (of month / weekday for weekly)"><input name="reportDay" type="number" min={0} max={28} defaultValue={s.reportDay} className="input" disabled={!can} /></Field>
                <Field label="Report recipients"><input name="reportRecipients" defaultValue={s.reportRecipients.join(", ")} className="input" disabled={!can} /></Field>
              </div>
              <Toggle name="weeklyReport" label="Weekly report" defaultChecked={s.weeklyReport} disabled={!can} />
              <Toggle name="monthlyReport" label="Monthly report" defaultChecked={s.monthlyReport} disabled={!can} />
              <Toggle name="reportAutoEmail" label="Auto email (otherwise client portal only)" defaultChecked={s.reportAutoEmail} disabled={!can} />
              <Toggle name="reportWhiteLabel" label="White label" defaultChecked={s.reportWhiteLabel} disabled={!can} />
            </Card>
          </div>
          {can && <div className="flex justify-end"><SubmitButton>Save automation settings</SubmitButton></div>}
        </ActionForm>
      )}

      {tab === "settings" && can && (
        <Card title="Service package" subtitle="Changing the package updates automations accordingly">
          <ActionForm action={changePackageAction.bind(null, id)} resetOnSuccess={false} className="flex flex-wrap items-end gap-3">
            <Field label="Package"><select name="packageId" defaultValue={client.packageId ?? ""} className="input"><option value="">None</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.gbpPostsPerWeek} posts/wk, {p.blogsPerMonth} blogs/mo, ranks {p.rankTracking.toLowerCase()}</option>)}</select></Field>
            <SubmitButton className="btn-secondary">Apply package</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {tab === "consent" && (
        <Card title="Automation consent" subtitle={`Recorded ${timeAgo(consent.recordedAt)} — every change is kept in history and the audit log`}>
          <ActionForm action={updateConsentAction.bind(null, id)} resetOnSuccess={false}>
            <div className="grid gap-x-8 md:grid-cols-2">
              {([["gbpAutoPosting", "Allow GBP auto posting"], ["aiImages", "Allow AI-generated images"], ["positiveReviewReplies", "Allow positive review replies"], ["websiteMetadataChanges", "Allow website metadata changes"], ["internalLinking", "Allow internal linking"], ["blogs", "Allow blogs"], ["autoPublishing", "Allow auto publishing"], ["reports", "Allow reports"], ["rankTracking", "Allow ranking tracking"], ["gbpProfileEdits", "Allow safe GBP profile edits"]] as const).map(([k, l]) => <Toggle key={k} name={k} label={l} defaultChecked={consent[k]} disabled={!can} />)}
            </div>
            {can && <div className="mt-4"><SubmitButton>Record consent</SubmitButton></div>}
          </ActionForm>
          <details className="mt-4 text-xs"><summary className="cursor-pointer text-ink-500">Consent history</summary>
            <ul className="mt-2 space-y-1">{((consent.history as { at: string; by: string; changes: { k: string; to: boolean }[] }[]) ?? []).slice().reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {h.by}: {h.changes.map((c) => `${c.k} → ${c.to ? "on" : "off"}`).join(", ") || "no changes"}</li>)}</ul>
          </details>
        </Card>
      )}

      {tab === "recommendations" && (
        <Card title="AI recommendations" subtitle="Structured actions with reason, evidence, risk and confidence" pad={false}>
          <ul className="divide-y divide-ink-100">
            {recs.map((r) => (
              <li key={r.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.title}</span>
                  <StatusBadge status={r.status} />
                  <Badge tone={r.actionClass === "AUTO_SAFE" ? "green" : r.actionClass === "PROTECTED" ? "red" : "amber"}>{r.actionClass.replace("_", "-").toLowerCase()}</Badge>
                  <Badge>{Math.round(r.confidence * 100)}% confidence</Badge>
                  <Badge tone="gray">{r.risk.toLowerCase()} risk</Badge>
                  <span className="ml-auto flex gap-1">
                    {ctx.can("approve_content") && ["PROPOSED", "NEEDS_APPROVAL", "FAILED"].includes(r.status) && ACTIONS[r.action]?.actionClass !== "PROTECTED" && <ActionButton action={recommendationAction.bind(null, r.id, "execute")} className="btn-primary btn-sm">Execute</ActionButton>}
                    {ctx.can("approve_content") && ["PROPOSED", "NEEDS_APPROVAL", "SCHEDULED"].includes(r.status) && <ActionButton action={recommendationAction.bind(null, r.id, "dismiss")} className="btn-ghost btn-sm">Dismiss</ActionButton>}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-600">{r.reason}{r.seoBenefit ? ` · Benefit: ${r.seoBenefit}` : ""}{r.expectedImpact ? ` · Impact: ${r.expectedImpact}` : ""}</p>
                {(r.currentValue || r.suggestedValue) && (
                  <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                    <div className="rounded-lg bg-ink-50 p-2"><b>Current:</b> {r.currentValue?.slice(0, 280) ?? "—"}</div>
                    <div className="rounded-lg bg-brand-50/60 p-2"><b>Suggested:</b> {r.suggestedValue?.slice(0, 280) ?? "—"}</div>
                  </div>
                )}
                <div className="mt-1 text-[11px] text-ink-400">{ACTIONS[r.action]?.label ?? r.action} · evidence: {r.sourceSignals.join(", ")} {r.blockedReason ? `· ${r.blockedReason}` : ""} {r.outcome ? `· ${r.outcome}` : ""} · {timeAgo(r.updatedAt)}</div>
              </li>
            ))}
          </ul>
          {!recs.length && <EmptyState title="No recommendations yet" />}
        </Card>
      )}

      {tab === "history" && (
        <Card title="Execution history" pad={false} actions={<Link href={`/automations/history?client=${id}`} className="link text-xs">Open in Command Center</Link>}>
          <table className="w-full"><thead className="bg-ink-50/60"><tr>{["Automation", "Status", "Attempts", "Started", "Completed", "Error", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="tr text-xs">
                  <td className="td font-medium">{r.label ?? r.type}<div className="text-[10px] text-ink-400">{r.type}</div></td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                  <td className="td">{r.attempts}/{r.maxAttempts}</td>
                  <td className="td">{timeAgo(r.startedAt ?? r.runAt)}</td>
                  <td className="td">{timeAgo(r.completedAt)}</td>
                  <td className="td max-w-[260px] truncate text-red-600" title={r.lastError ?? ""}>{r.lastError ?? ""}</td>
                  <td className="td">{ctx.can("view_command_center") && ["FAILED", "NEEDS_HUMAN", "CANCELLED"].includes(r.status) && <ActionButton action={runControlAction.bind(null, r.id, "retry")}>Retry</ActionButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
