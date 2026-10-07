"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, type FormAction } from "./client";
import { addCallAction, addKeywordAction, addNoteAction, createTaskAction, generateContentAction, generateImageAction, requestClientApprovalAction } from "@/app/actions/clients";

const CALL_TAGS = ["SEO", "GBP", "Website", "Billing", "Technical", "Review", "Content", "Complaint", "General"];

export function CallForm({ clientId, clients, onDone }: { clientId?: string; clients?: { id: string; name: string }[]; onDone?: () => void }) {
  const [follow, setFollow] = useState("no");
  const now = new Date();
  return (
    <ActionForm action={addCallAction as FormAction} onSuccess={onDone} className="grid gap-3 sm:grid-cols-2">
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : (
        <Field label="Client" className="sm:col-span-2">
          <select name="clientId" className="input" required>{clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
      )}
      <Field label="Contact"><input name="contactName" className="input" placeholder="Who did you speak with?" /></Field>
      <Field label="Direction">
        <select name="direction" className="input"><option value="OUTGOING">Outgoing</option><option value="INCOMING">Incoming</option></select>
      </Field>
      <Field label="Date"><input name="date" type="date" defaultValue={now.toISOString().slice(0, 10)} className="input" /></Field>
      <Field label="Time"><input name="time" type="time" defaultValue={now.toTimeString().slice(0, 5)} className="input" /></Field>
      <Field label="Result">
        <select name="outcome" className="input"><option value="ANSWERED">Answered</option><option value="NO_ANSWER">No Answer</option><option value="VOICEMAIL">Voicemail</option><option value="BUSY">Busy</option></select>
      </Field>
      <Field label="Duration (minutes)"><input name="duration" type="number" min={0} className="input" /></Field>
      <Field label="Purpose" className="sm:col-span-2"><input name="purpose" className="input" placeholder="Monthly check-in, billing question…" /></Field>
      <Field label="Discussion" className="sm:col-span-2"><textarea name="discussion" rows={3} className="input" /></Field>
      <Field label="Outcome" className="sm:col-span-2"><input name="result" className="input" placeholder="What was agreed?" /></Field>
      <Field label="Follow-up required?">
        <select name="followUpRequired" value={follow} onChange={(e) => setFollow(e.target.value)} className="input"><option value="no">No</option><option value="yes">Yes</option></select>
      </Field>
      {follow === "yes" && <Field label="Follow-up date"><input name="followUpDate" type="date" className="input" defaultValue={new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)} /></Field>}
      <div className="sm:col-span-2">
        <span className="label">Tags</span>
        <div className="flex flex-wrap gap-1.5">
          {CALL_TAGS.map((t) => (
            <label key={t} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-1 text-xs has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
              <input type="checkbox" name="tags" value={t} className="hidden" />{t}
            </label>
          ))}
        </div>
      </div>
      <div className="sm:col-span-2 flex justify-end"><SubmitButton>Save call</SubmitButton></div>
    </ActionForm>
  );
}

export function NoteForm({ clientId, clients, onDone }: { clientId?: string; clients?: { id: string; name: string }[]; onDone?: () => void }) {
  return (
    <ActionForm action={addNoteAction as FormAction} onSuccess={onDone} className="grid gap-3 sm:grid-cols-2">
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : (
        <Field label="Client" className="sm:col-span-2"><select name="clientId" className="input">{clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      )}
      <Field label="Note" className="sm:col-span-2" hint="Use @Name or @SEOManager / @SupportAgent / @ContentTeam to notify colleagues"><textarea name="body" rows={4} required className="input" /></Field>
      <Field label="Category">
        <select name="category" className="input">{["General", "Campaign", "Content Preferences", "Client Request", "Billing", "Technical", "Complaint", "Onboarding"].map((c) => <option key={c}>{c}</option>)}</select>
      </Field>
      <Field label="Priority">
        <select name="priority" className="input" defaultValue="NORMAL"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select>
      </Field>
      <Field label="Visibility">
        <select name="visibility" className="input"><option value="INTERNAL">Internal only</option><option value="CLIENT_VISIBLE">Client visible</option></select>
      </Field>
      <Field label="Attachment"><input name="attachment" type="file" className="input py-1.5 text-xs" /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="useAsAiContext" className="h-4 w-4 rounded" /> Use this note as AI context <span className="text-xs text-ink-400">(added to the client&apos;s AI Business Brain)</span></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" className="h-4 w-4 rounded" /> Pin note</label>
      <div className="flex justify-end sm:col-span-2"><SubmitButton>Save note</SubmitButton></div>
    </ActionForm>
  );
}

export function TaskForm({ clientId, clients, members, onDone }: { clientId?: string; clients?: { id: string; name: string }[]; members: { id: string; name: string }[]; onDone?: () => void }) {
  return (
    <ActionForm action={createTaskAction as FormAction} onSuccess={onDone} className="grid gap-3 sm:grid-cols-2">
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : (
        <Field label="Client (optional)" className="sm:col-span-2"><select name="clientId" className="input"><option value="">— Agency task —</option>{clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      )}
      <Field label="Title" className="sm:col-span-2"><input name="title" required className="input" /></Field>
      <Field label="Description" className="sm:col-span-2"><textarea name="description" rows={3} className="input" placeholder="Mention teammates with @Name" /></Field>
      <Field label="Category">
        <select name="category" className="input">{["General", "Support", "Follow-Up", "GBP", "SEO", "Website", "Content", "Technical", "Onboarding", "Review"].map((c) => <option key={c}>{c}</option>)}</select>
      </Field>
      <Field label="Priority"><select name="priority" className="input" defaultValue="NORMAL"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></Field>
      <Field label="Assign to"><select name="assignedToId" className="input"><option value="">Me</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label="Due"><input name="dueAt" type="datetime-local" className="input" /></Field>
      <div className="flex justify-end sm:col-span-2"><SubmitButton>Create task</SubmitButton></div>
    </ActionForm>
  );
}

export function GenerateContentForm({ clientId, type, services, onDone }: { clientId: string; type: "GBP_POST" | "BLOG"; services: string[]; onDone?: () => void }) {
  return (
    <ActionForm action={generateContentAction as FormAction} onSuccess={onDone} className="grid gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="type" value={type} />
      <Field label="Topic (optional)" hint="Leave blank and the AI picks a fresh topic using content memory and priorities"><input name="topic" className="input" /></Field>
      <Field label="Service to promote"><select name="service" className="input"><option value="">AI chooses (priority / least recently promoted)</option>{services.map((s) => <option key={s}>{s}</option>)}</select></Field>
      {type === "GBP_POST" && <Field label="Post type"><select name="category" className="input">{["Service", "Educational", "Offer", "Seasonal"].map((c) => <option key={c}>{c}</option>)}</select></Field>}
      <Field label="Schedule for"><input name="scheduledFor" type="datetime-local" className="input" /></Field>
      <div className="flex justify-end"><SubmitButton pendingText="Queuing…">Generate {type === "BLOG" ? "blog" : "post"}</SubmitButton></div>
    </ActionForm>
  );
}

export function ImageForm({ clientId, onDone }: { clientId: string; onDone?: () => void }) {
  return (
    <ActionForm action={generateImageAction as FormAction} onSuccess={onDone} className="grid gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="Image concept" hint="Contextual promotional scenes only — the generator refuses fake staff, awards, certificates, before/after results, storefronts or testimonials"><textarea name="concept" rows={3} className="input" placeholder="Premium kitchen with white quartz countertops, natural light" /></Field>
      <Field label="Purpose"><select name="purpose" className="input"><option value="GBP_POST">GBP post</option><option value="BLOG">Blog</option><option value="SOCIAL">Social</option><option value="WEBSITE">Website</option></select></Field>
      <div className="flex justify-end"><SubmitButton pendingText="Generating…">Generate image</SubmitButton></div>
    </ActionForm>
  );
}

export function KeywordForm({ clientId, onDone }: { clientId: string; onDone?: () => void }) {
  return (
    <ActionForm action={addKeywordAction as FormAction} onSuccess={onDone} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="Keywords" hint="One per line" className="sm:col-span-2"><textarea name="phrases" rows={4} className="input" placeholder={"granite countertops thunder bay\nquartz countertops near me"} /></Field>
      <Field label="Group"><select name="group" className="input">{["PRIMARY", "SECONDARY", "GBP", "SERVICE", "LOCATION", "BLOG"].map((g) => <option key={g} value={g}>{g.charAt(0) + g.slice(1).toLowerCase()}</option>)}</select></Field>
      <Field label="Location"><input name="location" className="input" placeholder="Thunder Bay, ON" /></Field>
      <Field label="Target page (optional)" className="sm:col-span-2"><input name="targetUrl" className="input" /></Field>
      <div className="flex justify-end sm:col-span-2"><SubmitButton>Add keywords</SubmitButton></div>
    </ActionForm>
  );
}

export function ApprovalRequestForm({ clientId, onDone }: { clientId: string; onDone?: () => void }) {
  return (
    <ActionForm action={requestClientApprovalAction as FormAction} onSuccess={onDone} className="grid gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="What needs approval?"><input name="title" required className="input" placeholder="New GBP description" /></Field>
      <Field label="Category"><select name="category" className="input">{["GBP", "WEBSITE", "CONTENT", "REVIEWS", "IMAGES", "TECHNICAL"].map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}</select></Field>
      <Field label="Current"><textarea name="current" rows={2} className="input" /></Field>
      <Field label="Recommended"><textarea name="recommended" rows={3} className="input" /></Field>
      <Field label="Why (plain English for the client)"><textarea name="reason" rows={2} className="input" /></Field>
      <div className="flex justify-end"><SubmitButton>Send to client</SubmitButton></div>
    </ActionForm>
  );
}
