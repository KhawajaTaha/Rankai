import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientWhere } from "@/lib/tenancy";
import { checkClaims } from "@/lib/ai/safety";
import { Badge, Card, DemoBadge, KeyValue, PageHeader, StatusBadge, fmtDate } from "@/components/ui";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/client";
import { Markdown } from "@/components/markdown";
import { contentOpAction, updateContentAction } from "@/app/actions/content";
import { pretty } from "@/lib/labels";

export default async function ContentItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const ctx = await requireStaff();
  const { itemId } = await params;
  const item = await db.contentItem.findFirst({ where: { id: itemId, client: clientWhere(ctx) }, include: { client: { include: { knowledge: true } }, image: { include: { aiImage: true } } } });
  if (!item) notFound();
  const seo = (item.seo ?? {}) as { slug?: string; seoTitle?: string; metaDescription?: string; searchIntent?: string; faqs?: { question: string; answer: string }[]; internalLinks?: { anchor: string; url: string }[]; externalReferences?: { title: string; url: string }[]; schema?: unknown; wordCount?: number; featuredImage?: { altText: string; title: string; caption: string } };
  const safety = item.body ? checkClaims(item.body, { wordsToAvoid: item.client.knowledge?.wordsToAvoid, doNotPromote: item.client.knowledge?.doNotPromote }) : { issues: [] };
  const editable = item.status !== "PUBLISHED" && ctx.can("create_content");
  const op = (o: Parameters<typeof contentOpAction>[1]) => contentOpAction.bind(null, item.id, o);
  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/clients/${item.clientId}/content`} className="link">{item.client.name}</Link>}
        title={item.title}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{pretty(item.type)} · <StatusBadge status={item.status} /> {item.aiModel === "demo-generator" && <DemoBadge label="Demo AI" />} · {item.status === "PUBLISHED" ? `Published ${fmtDate(item.publishedAt, true)}` : `Scheduled ${fmtDate(item.scheduledFor, true)}`}</span>}
        actions={
          <>
            {ctx.can("approve_content") && ["NEEDS_APPROVAL", "DRAFT", "APPROVED"].includes(item.status) && <ActionButton action={op("approve")} className="btn-primary btn-sm">Approve & schedule</ActionButton>}
            {ctx.can("publish_content") && ["SCHEDULED", "APPROVED", "FAILED"].includes(item.status) && <ActionButton action={op("publish")} className="btn-primary btn-sm" confirm="Publish now?">Publish now</ActionButton>}
            {ctx.can("create_content") && item.status !== "PUBLISHED" && <ActionButton action={op("regenerate")}>Regenerate</ActionButton>}
            {ctx.can("publish_content") && !["PUBLISHED", "PAUSED"].includes(item.status) && <ActionButton action={op("pause")}>Pause</ActionButton>}
            {ctx.can("publish_content") && item.status === "PAUSED" && <ActionButton action={op("resume")}>Resume</ActionButton>}
            {ctx.can("approve_content") && !["PUBLISHED", "REJECTED"].includes(item.status) && <ActionButton action={op("reject")} className="btn-ghost btn-sm">Reject</ActionButton>}
          </>
        }
      />
      {item.failureReason && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Last attempt failed: {item.failureReason}</div>}
      {safety.issues.length > 0 && <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Review flagged: {safety.issues.join(" · ")}</div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Preview">
            {item.image && (  <img src={item.image.url} alt={item.image.altText ?? ""} className="mb-4 max-h-80 w-full rounded-xl object-cover" />)}
            {item.body ? <Markdown text={item.body} className="prose-sm text-sm text-ink-800" /> : <p className="text-sm text-ink-500">Not generated yet — content is generated a few days before its slot.</p>}
            {item.cta && <div className="mt-4"><Badge tone="blue">CTA: {item.cta}</Badge></div>}
          </Card>
          {editable && item.body && (
            <Card title="Edit">
              <ActionForm action={updateContentAction.bind(null, item.id)} resetOnSuccess={false} className="grid gap-3">
                <Field label="Title"><input name="title" defaultValue={item.title} className="input" /></Field>
                <Field label="Body"><textarea name="body" rows={item.type === "BLOG" ? 20 : 8} defaultValue={item.body} className="input font-mono text-xs" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="CTA"><input name="cta" defaultValue={item.cta ?? ""} className="input" /></Field>
                  <Field label="Scheduled for"><input name="scheduledFor" type="datetime-local" defaultValue={item.scheduledFor ? new Date(item.scheduledFor.getTime() - item.scheduledFor.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} className="input" /></Field>
                </div>
                <div><SubmitButton>Save changes</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card title="Details">
            <KeyValue items={[
              { label: "Service promoted", value: item.servicePromoted }, { label: "Category", value: item.category }, { label: "Primary keyword", value: item.primaryKeyword }, { label: "Keywords", value: item.keywords.join(", ") },
              { label: "Generated by", value: pretty(item.generatedBy) }, { label: "Model", value: item.aiModel }, { label: "External ID", value: item.externalId }, { label: "Attempts", value: item.attempts },
            ]} />
            {item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer" className="link mt-3 block text-xs">{item.externalUrl}</a>}
          </Card>
          {item.type === "BLOG" && item.seo != null && (
            <Card title="SEO package">
              <KeyValue items={[{ label: "Slug", value: seo.slug }, { label: "SEO title", value: seo.seoTitle }, { label: "Meta description", value: seo.metaDescription }, { label: "Intent", value: seo.searchIntent }, { label: "Words", value: seo.wordCount }, { label: "Image alt", value: seo.featuredImage?.altText }]} />
              {seo.internalLinks?.length ? <div className="mt-3 text-xs"><div className="label">Internal links</div>{seo.internalLinks.map((l) => <div key={l.url}>{l.anchor} → {l.url}</div>)}</div> : null}
              {seo.faqs?.length ? <div className="mt-3 text-xs"><div className="label">FAQs (FAQ schema)</div>{seo.faqs.map((f) => <div key={f.question} className="mb-1"><b>{f.question}</b> {f.answer}</div>)}</div> : null}
              <details className="mt-3 text-xs"><summary className="cursor-pointer text-ink-500">Article + FAQ schema JSON-LD</summary><pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-ink-50 p-2">{JSON.stringify(seo.schema, null, 2)}</pre></details>
            </Card>
          )}
          {item.image?.aiImage && (
            <Card title="AI image">
              <p className="text-xs text-ink-600">{item.image.aiImage.prompt}</p>
              <div className="mt-2 flex flex-wrap gap-1"><Badge tone="purple">{item.image.aiImage.provider}</Badge><Badge tone={item.image.aiImage.safetyPassed ? "green" : "amber"}>safety {item.image.aiImage.safetyPassed ? "passed" : "rewritten"}</Badge><StatusBadge status={item.image.status} /></div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
