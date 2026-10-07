"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionResult = { ok: boolean; message?: string; error?: string; redirect?: string } | null;
export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

const DialogCtx = createContext<{ close: () => void } | null>(null);

export function SubmitButton({ children, className = "btn-primary", pendingText, name, value }: { children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** Form wrapper for server actions: shows success/error, optional reset + close-dialog on success. */
export function ActionForm({ action, children, className, resetOnSuccess = true, onSuccess, hideMessage }: { action: FormAction; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; onSuccess?: () => void; hideMessage?: boolean }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const dialog = useContext(DialogCtx);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
      if (!onSuccess && dialog) setTimeout(dialog.close, 600);
      if (state.redirect) router.push(state.redirect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {!hideMessage && state && (state.error || state.message) && (
        <div className={cn("mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs", state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700")}>
          {state.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{state.error ?? state.message}</span>
        </div>
      )}
    </form>
  );
}

/** Modal dialog (native <dialog>) with a trigger button. */
export function Dialog({ trigger, title, description, children, triggerClassName = "btn-secondary", wide }: { trigger: React.ReactNode; title: string; description?: string; children: React.ReactNode | ((close: () => void) => React.ReactNode); triggerClassName?: string; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    ref.current?.close();
    setOpen(false);
  };
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => { setOpen(true); ref.current?.showModal(); }}>
        {trigger}
      </button>
      <dialog ref={ref} onClose={() => setOpen(false)} className={cn("w-[calc(100%-2rem)] rounded-2xl border border-ink-200 p-0 shadow-pop", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-start justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink-900">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
          </div>
          <button type="button" onClick={close} className="btn-ghost btn-sm" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4"><DialogCtx.Provider value={{ close }}>{open && (typeof children === "function" ? children(close) : children)}</DialogCtx.Provider></div>
      </dialog>
    </>
  );
}

/** Small button that invokes a bound server action, with optional confirmation. */
export function ActionButton({ action, children, className = "btn-secondary btn-sm", confirm, title }: { action: () => Promise<ActionResult | void>; children: React.ReactNode; className?: string; confirm?: string; title?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        title={title}
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            if (r) setMsg(r);
            if (r?.redirect) router.push(r.redirect);
            else router.refresh();
          });
        }}
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </button>
      {msg?.error && <span className="text-xs text-red-600">{msg.error}</span>}
    </span>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-400">{hint}</span>}
    </label>
  );
}

export function Toggle({ name, defaultChecked, label, description, disabled }: { name: string; defaultChecked?: boolean; label: string; description?: string; disabled?: boolean }) {
  const [on, setOn] = useState(Boolean(defaultChecked));
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-4 py-2", disabled && "cursor-not-allowed opacity-60")}>
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {description && <span className="block text-xs text-ink-500">{description}</span>}
      </span>
      <input type="hidden" name={name} value={on ? "on" : "off"} />
      <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => setOn(!on)} className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition", on ? "bg-brand-600" : "bg-ink-200")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", on ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

/** Select all / bulk selection helper for tables. */
export function BulkSelect({ name = "ids" }: { name?: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      className="h-4 w-4 rounded border-ink-300"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((cb) => (cb.checked = e.currentTarget.checked));
      }}
    />
  );
}

/** Reorderable dashboard widgets — order is persisted per user (spec §90). */
export function WidgetBoard({ widgets, order, save }: { widgets: { id: string; title: string; node: React.ReactNode; span?: 1 | 2 | 3 }[]; order: string[]; save: (order: string[]) => Promise<void> }) {
  const known = widgets.map((w) => w.id);
  const initial = [...order.filter((id) => known.includes(id)), ...known.filter((id) => !order.includes(id))];
  const [ids, setIds] = useState(initial);
  const [edit, setEdit] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const move = (id: string, dir: -1 | 1) => {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setIds(next);
    void save(next);
  };
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(!edit)}>{edit ? "Done" : "Customize layout"}</button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {ids.map((id) => {
          const w = widgets.find((x) => x.id === id)!;
          return (
            <div
              key={id}
              draggable={edit}
              onDragStart={() => setDrag(id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!drag || drag === id) return;
                const next = ids.filter((x) => x !== drag);
                next.splice(next.indexOf(id), 0, drag);
                setIds(next);
                setDrag(null);
                void save(next);
              }}
              className={cn(w.span === 3 ? "lg:col-span-3" : w.span === 2 ? "lg:col-span-2" : "", edit && "cursor-move rounded-2xl ring-2 ring-dashed ring-brand-200")}
            >
              {edit && (
                <div className="mb-1 flex items-center justify-between px-1 text-xs text-ink-500">
                  <span>{w.title}</span>
                  <span className="flex gap-1">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => move(id, -1)}>↑</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => move(id, 1)}>↓</button>
                  </span>
                </div>
              )}
              {w.node}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-secondary btn-sm" onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}
