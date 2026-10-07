"use client";

import Link from "next/link";
import { BarChart3, CalendarPlus, CheckSquare, FileText, Globe, Image as ImageIcon, KeyRound, ListPlus, MapPin, Megaphone, PauseCircle, Phone, PlayCircle, RefreshCw, Search, Send, StickyNote, TrendingUp } from "lucide-react";
import { ActionButton, Dialog, type ActionResult } from "@/components/client";
import { ApprovalRequestForm, CallForm, GenerateContentForm, ImageForm, KeywordForm, NoteForm, TaskForm } from "@/components/forms";

type Bound = () => Promise<ActionResult>;

export function QuickActions(p: {
  clientId: string;
  services: string[];
  members: { id: string; name: string }[];
  perms: Record<string, boolean>;
  paused: boolean;
  jobs: { gbpAudit: Bound; websiteAudit: Bound; ranks: Bound; report: Bound };
  togglePause: Bound;
}) {
  const sm = "btn-secondary btn-sm";
  return (
    <div className="flex flex-wrap gap-1.5">
      {p.perms.add_calls && <Dialog trigger={<><Phone className="h-3.5 w-3.5" /> Add Call</>} title="Log a call" triggerClassName={sm} wide>{(close) => <CallForm clientId={p.clientId} onDone={close} />}</Dialog>}
      {p.perms.add_notes && <Dialog trigger={<><StickyNote className="h-3.5 w-3.5" /> Add Note</>} title="Add a note" triggerClassName={sm} wide>{(close) => <NoteForm clientId={p.clientId} onDone={close} />}</Dialog>}
      {p.perms.create_tasks && <Dialog trigger={<><ListPlus className="h-3.5 w-3.5" /> Create Task</>} title="Create a task" triggerClassName={sm} wide>{(close) => <TaskForm clientId={p.clientId} members={p.members} onDone={close} />}</Dialog>}
      {p.perms.create_content && (
        <>
          <Dialog trigger={<><Megaphone className="h-3.5 w-3.5" /> GBP Post</>} title="Generate GBP post" description="Uses the client's AI Business Brain, brand kit and content memory" triggerClassName={sm}>{(close) => <GenerateContentForm clientId={p.clientId} type="GBP_POST" services={p.services} onDone={close} />}</Dialog>
          <Dialog trigger={<><FileText className="h-3.5 w-3.5" /> Blog</>} title="Generate blog" triggerClassName={sm}>{(close) => <GenerateContentForm clientId={p.clientId} type="BLOG" services={p.services} onDone={close} />}</Dialog>
          <Dialog trigger={<><ImageIcon className="h-3.5 w-3.5" /> AI Image</>} title="Generate AI image" triggerClassName={sm}>{(close) => <ImageForm clientId={p.clientId} onDone={close} />}</Dialog>
        </>
      )}
      <details className="relative">
        <summary className={`${sm} list-none cursor-pointer`}>More…</summary>
        <div className="absolute right-0 z-30 mt-1 flex w-60 flex-col gap-1 rounded-2xl border border-ink-200 bg-white p-2 shadow-pop">
          {p.perms.run_audit && <ActionButton action={p.jobs.gbpAudit} className="btn-ghost btn-sm justify-start"><MapPin className="h-3.5 w-3.5" /> Run GBP Audit</ActionButton>}
          {p.perms.run_audit && <ActionButton action={p.jobs.websiteAudit} className="btn-ghost btn-sm justify-start"><Search className="h-3.5 w-3.5" /> Run Website Audit</ActionButton>}
          {p.perms.manage_keywords && <ActionButton action={p.jobs.ranks} className="btn-ghost btn-sm justify-start"><TrendingUp className="h-3.5 w-3.5" /> Check Rankings</ActionButton>}
          {p.perms.generate_reports && <ActionButton action={p.jobs.report} className="btn-ghost btn-sm justify-start"><BarChart3 className="h-3.5 w-3.5" /> Generate Report</ActionButton>}
          {p.perms.manage_keywords && <Dialog trigger={<><KeyRound className="h-3.5 w-3.5" /> Add Keyword</>} title="Add keywords" triggerClassName="btn-ghost btn-sm justify-start">{(close) => <KeywordForm clientId={p.clientId} onDone={close} />}</Dialog>}
          <Link href={`/clients/${p.clientId}/gbp`} className="btn-ghost btn-sm justify-start"><RefreshCw className="h-3.5 w-3.5" /> Connect GBP</Link>
          <Link href={`/clients/${p.clientId}/website`} className="btn-ghost btn-sm justify-start"><Globe className="h-3.5 w-3.5" /> Connect Website</Link>
          {p.perms.create_content && <Dialog trigger={<><Send className="h-3.5 w-3.5" /> Request Client Approval</>} title="Request client approval" triggerClassName="btn-ghost btn-sm justify-start">{(close) => <ApprovalRequestForm clientId={p.clientId} onDone={close} />}</Dialog>}
          <Link href={`/content?client=${p.clientId}`} className="btn-ghost btn-sm justify-start"><CalendarPlus className="h-3.5 w-3.5" /> Content calendar</Link>
          <Link href={`/approvals?client=${p.clientId}`} className="btn-ghost btn-sm justify-start"><CheckSquare className="h-3.5 w-3.5" /> Approvals</Link>
        </div>
      </details>
      {p.perms.pause_automation && (
        <ActionButton action={p.togglePause} className={p.paused ? "btn-primary btn-sm" : "btn-secondary btn-sm"} confirm={p.paused ? undefined : "Pause all automation for this client? Scheduled publishing and auto-fixes will stop."}>
          {p.paused ? <><PlayCircle className="h-3.5 w-3.5" /> Resume Automation</> : <><PauseCircle className="h-3.5 w-3.5" /> Pause Automation</>}
        </ActionButton>
      )}
    </div>
  );
}
