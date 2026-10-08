"use client";

import { useActionState, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { ActionResult, FormAction } from "./client";
import { Markdown } from "./markdown";

export function AssistantPanel({ action, suggestions, placeholder, mode }: { action: FormAction; suggestions: string[]; placeholder: string; mode: "LIVE" | "DEMO" }) {
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const [q, setQ] = useState("");
  const [state, formAction, pending] = useActionState(async (prev: ActionResult, f: FormData) => {
    const res = await action(prev, f);
    if (res?.ok && res.message) setHistory((h) => [...h, { q: String(f.get("q")), a: res.message! }]);
    setQ("");
    return res;
  }, null);
  return (
    <div>
      <div className="max-h-[420px] space-y-4 overflow-y-auto">
        {history.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => <button key={s} type="button" onClick={() => setQ(s)} className="rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-600 hover:border-brand-300 hover:bg-brand-50">{s}</button>)}
          </div>
        )}
        {history.map((h, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3 py-2 text-sm text-white">{h.q}</div>
            <div className="flex gap-2">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Sparkles className="h-3.5 w-3.5" /></span>
              <Markdown text={h.a} className="min-w-0 flex-1 text-sm text-ink-800" />
            </div>
          </div>
        ))}
        {pending && <div className="flex items-center gap-2 text-xs text-ink-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</div>}
        {state?.error && <div className="text-xs text-red-600">{state.error}</div>}
      </div>
      <form action={formAction} className="mt-3 flex gap-2">
        <input name="q" value={q} onChange={(e) => setQ(e.target.value)} className="input" placeholder={placeholder} required minLength={3} />
        <button className="btn-primary" disabled={pending}>Ask</button>
      </form>
      {mode === "DEMO" && <p className="mt-2 text-[11px] text-ink-400">Rules mode: answers are computed directly from your data without an AI model. Add ANTHROPIC_API_KEY for full AI answers.</p>}
    </div>
  );
}
