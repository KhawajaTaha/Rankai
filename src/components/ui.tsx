import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn, initials } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-ink-500">{eyebrow}</div>}
        <h1 className="truncate text-[22px] font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, pad = true }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn("card", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

const TONES = {
  gray: "bg-ink-100 text-ink-700 ring-ink-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-brand-50 text-brand-700 ring-brand-200",
  purple: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "gray", className, dot }: { children: React.ReactNode; tone?: Tone; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", tone === "green" ? "bg-emerald-500" : tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : tone === "blue" ? "bg-brand-500" : "bg-ink-400")} />}
      {children}
    </span>
  );
}

export function DemoBadge({ label = "Demo Mode" }: { label?: string }) {
  return (
    <span title="No live credentials configured — realistic mocked data is used" className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-300">
      {label}
    </span>
  );
}

export function severityTone(s: string | null | undefined): Tone {
  return s === "CRITICAL" || s === "URGENT" ? "red" : s === "HIGH" ? "amber" : s === "MEDIUM" || s === "NORMAL" ? "blue" : "gray";
}

export function statusTone(s: string): Tone {
  if (["SUCCEEDED", "PUBLISHED", "CONNECTED", "COMPLETED", "APPROVED", "VERIFIED", "EXECUTED", "POSTED", "HEALTHY", "RESOLVED", "READY", "SENT", "ACTIVE", "FULLY_ACTIVE"].includes(s)) return "green";
  if (["FAILED", "ERROR", "EXPIRED", "DISCONNECTED", "REJECTED", "URGENT", "NEEDS_HUMAN", "CRITICAL", "BLOCKED"].includes(s)) return "red";
  if (["NEEDS_APPROVAL", "PENDING", "WAITING_FOR_APPROVAL", "RETRYING", "NEEDS_FOLLOW_UP", "WAITING_FOR_CLIENT", "SEO_ATTENTION_NEEDED", "DRAFTED", "UNANSWERED", "PAUSED", "ONBOARDING", "OPEN"].includes(s)) return "amber";
  if (["RUNNING", "IN_PROGRESS", "SCHEDULED", "QUEUED", "GENERATING", "PUBLISHING", "NEW_CLIENT"].includes(s)) return "blue";
  return "gray";
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={statusTone(status)} dot>
      {label ?? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

export function Stat({ label, value, delta, hint, icon, href, tone }: { label: string; value: React.ReactNode; delta?: number | null; hint?: React.ReactNode; icon?: React.ReactNode; href?: string; tone?: "red" | "amber" | "green" }) {
  const body = (
    <div className={cn("card card-pad h-full transition", href && "hover:border-brand-200 hover:shadow-pop")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-500">{label}</span>
        {icon && <span className={cn("rounded-lg p-1.5", tone === "red" ? "bg-red-50 text-red-600" : tone === "amber" ? "bg-amber-50 text-amber-600" : tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-brand-50 text-brand-600")}>{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-ink-900">{value}</span>
        {delta != null && <Delta value={delta} />}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Delta({ value, invert, suffix = "%" }: { value: number | null | undefined; invert?: boolean; suffix?: string }) {
  if (value == null || Number.isNaN(value)) return null;
  const good = invert ? value < 0 : value > 0;
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", value === 0 ? "text-ink-500" : good ? "text-emerald-600" : "text-red-600")}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(Math.round(value * 10) / 10)}
      {suffix}
    </span>
  );
}

export function Progress({ value, tone = "brand", className }: { value: number; tone?: "brand" | "green" | "amber" | "red"; className?: string }) {
  const color = tone === "green" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : tone === "red" ? "bg-red-500" : "bg-brand-600";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink-100", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function ScoreRing({ score, size = 64, label }: { score: number | null | undefined; size?: number; label?: string }) {
  const s = score ?? 0;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = score == null ? "#c2c8d3" : s >= 80 ? "#10b981" : s >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} title={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#eef0f4" strokeWidth={5} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={5} fill="none" strokeDasharray={c} strokeDashoffset={c - (c * s) / 100} strokeLinecap="round" />
      </svg>
      <span className="absolute text-sm font-semibold text-ink-900" style={{ fontSize: size < 50 ? 11 : 15 }}>{score ?? "—"}</span>
    </div>
  );
}

export function Avatar({ name, src, size = 32, square }: { name: string; src?: string | null; size?: number; square?: boolean }) {
  const palette = ["bg-brand-100 text-brand-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-700", "bg-rose-100 text-rose-700", "bg-teal-100 text-teal-700"];
  const idx = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % palette.length;
  if (src) {
     
    return <img src={src} alt={name} width={size} height={size} className={cn("shrink-0 object-cover", square ? "rounded-xl" : "rounded-full")} style={{ width: size, height: size }} />;
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center font-semibold", square ? "rounded-xl" : "rounded-full", palette[idx])} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-2xl bg-ink-50 p-3 text-ink-400">{icon}</div>}
      <div className="text-sm font-semibold text-ink-800">{title}</div>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; count?: number }[]; active: string }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-ink-200">
      {tabs.map((t) => {
        const on = t.href === active;
        return (
          <Link key={t.href} href={t.href} className={cn("whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition", on ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")}>
            {t.label}
            {t.count != null && t.count > 0 && <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]", on ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-600")}>{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : Boolean(children);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="bg-ink-50/60">
          <tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {!hasRows && (empty ?? <EmptyState title="Nothing here yet" />)}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{i.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink-800">{i.value ?? <span className="text-ink-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Lightweight SVG line/area chart. */
export function LineChart({ series, height = 160, labels, invert, yMax }: { series: { name: string; values: (number | null)[]; color?: string }[]; height?: number; labels?: string[]; invert?: boolean; yMax?: number }) {
  const w = 600;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!all.length) return <EmptyState title="No data yet" />;
  const max = yMax ?? Math.max(...all) * 1.1;
  const min = invert ? Math.min(...all) * 0.9 : 0;
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * (w - 20) + 10);
  const y = (v: number) => {
    const t = (v - min) / (max - min || 1);
    return invert ? 10 + t * (height - 30) : height - 20 - t * (height - 30);
  };
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={w} y1={10 + g * (height - 30)} y2={10 + g * (height - 30)} stroke="#eef0f4" />)}
        {series.map((s, si) => {
          const color = s.color ?? ["#1f48f5", "#10b981", "#f59e0b", "#8b5cf6"][si % 4];
          const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return (
            <g key={s.name}>
              {si === 0 && !invert && <polygon points={`${x(0)},${height - 20} ${pts.join(" ")} ${x(s.values.length - 1)},${height - 20}`} fill={color} opacity={0.07} />}
              <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </svg>
      {labels && (
        <div className="mt-1 flex justify-between text-[10px] text-ink-400">
          <span>{labels[0]}</span>
          <span>{labels[Math.floor(labels.length / 2)]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-2 flex gap-3 text-xs text-ink-500">
          {series.map((s, si) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color ?? ["#1f48f5", "#10b981", "#f59e0b", "#8b5cf6"][si % 4] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function BarList({ items, max }: { items: { label: React.ReactNode; value: number; hint?: React.ReactNode }[]; max?: number }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i, idx) => (
        <li key={idx}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="truncate text-ink-700">{i.label}</span>
            <span className="ml-2 font-medium text-ink-900">{i.hint ?? i.value}</span>
          </div>
          <Progress value={(i.value / m) * 100} />
        </li>
      ))}
    </ul>
  );
}

export function Sparkline({ values, width = 90, height = 26, invert }: { values: (number | null)[]; width?: number; height?: number; invert?: boolean }) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2) return <span className="text-xs text-ink-300">—</span>;
  const max = Math.max(...v);
  const min = Math.min(...v);
  const pts = v.map((val, i) => {
    const t = (val - min) / (max - min || 1);
    return `${(i / (v.length - 1)) * width},${invert ? 2 + t * (height - 4) : height - 2 - t * (height - 4)}`;
  });
  const up = invert ? v[v.length - 1]! <= v[0]! : v[v.length - 1]! >= v[0]!;
  return (
    <svg width={width} height={height}>
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "#10b981" : "#ef4444"} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-1 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{children}</h3>
      {action}
    </div>
  );
}

export function timeAgo(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (Date.now() - date.getTime()) / 1000;
  const fut = diff < 0;
  const a = Math.abs(diff);
  const fmt = a < 60 ? "just now" : a < 3600 ? `${Math.floor(a / 60)}m` : a < 86400 ? `${Math.floor(a / 3600)}h` : a < 86400 * 30 ? `${Math.floor(a / 86400)}d` : date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  if (fmt === "just now" || a >= 86400 * 30) return fmt;
  return fut ? `in ${fmt}` : `${fmt} ago`;
}

export function fmtDate(d: Date | string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-CA", withTime ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
}
