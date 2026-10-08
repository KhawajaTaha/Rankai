"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Field } from "./client";

const TYPES: [string, string][] = [["MONTHLY_SEO", "Full SEO report"], ["EXECUTIVE", "Executive summary"], ["GBP", "Google Business Profile"], ["RANKING", "Rankings"], ["WEBSITE_SEO", "Website SEO"], ["CONTENT", "Content"], ["SUPPORT", "Support"], ["WEEKLY_SUMMARY", "Weekly summary"]];
const PRESETS: [string, string][] = [["30d", "Last 30 days"], ["7d", "Last 7 days"], ["90d", "Last 90 days"], ["this_month", "This month"], ["last_month", "Last month"], ["custom", "Custom range…"]];

/** Filtered report download: pick a period (default last 30 days), report type and PDF/CSV. */
export function ReportDownloadForm({ clients, clientId }: { clients?: { id: string; name: string }[]; clientId?: string }) {
  const [preset, setPreset] = useState("30d");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function download(form: HTMLFormElement, format: "pdf" | "csv") {
    setError(null);
    setBusy(format);
    try {
      const fd = new FormData(form);
      fd.set("format", format);
      const res = await fetch("/api/reports/export", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.text()) || "Download failed");
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `report.${format}`;
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void download(e.currentTarget, "pdf"); }}>
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : clients && (
        <Field label="Client"><select name="clientId" className="input">{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      )}
      <Field label="Period">
        <select name="preset" className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      {preset === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From"><input type="date" name="from" className="input" max={today} required /></Field>
          <Field label="To"><input type="date" name="to" className="input" max={today} defaultValue={today} required /></Field>
        </div>
      )}
      <Field label="Report"><select name="type" className="input">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={!!busy}>{busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Download PDF</button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={(e) => { const f = e.currentTarget.form; if (f?.reportValidity()) void download(f, "csv"); }}>{busy === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} CSV / Excel</button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-ink-400">Built from live data for the selected period, compared with the previous period of the same length.</p>
    </form>
  );
}

/** PDF / CSV buttons for an existing report. */
export function ReportFileLinks({ reportId, compact }: { reportId: string; compact?: boolean }) {
  const cls = compact ? "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800" : "btn-secondary";
  return (
    <span className="inline-flex gap-1">
      <a href={`/api/reports/${reportId}/download?format=pdf`} className={cls} title="Download PDF"><Download className="h-3.5 w-3.5" /> PDF</a>
      <a href={`/api/reports/${reportId}/download?format=csv`} className={cls} title="Download CSV"><Download className="h-3.5 w-3.5" /> CSV</a>
    </span>
  );
}
