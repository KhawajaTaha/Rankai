/** Minimal safe Markdown renderer (headings, bold, italics, bullet/numbered lists, paragraphs). No raw HTML. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(<Tag key={out.length} className={list.ordered ? "my-1.5 list-decimal space-y-1 pl-5" : "my-1.5 list-disc space-y-1 pl-5"}>{list.items.map((i, k) => <li key={k}>{inline(i)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const ul = /^\s*[-*]\s+(.*)$/.exec(l);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(l);
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (ul || ol) {
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]!);
      continue;
    }
    flush();
    if (h) out.push(<div key={out.length} className={h[1]!.length <= 2 ? "mt-3 text-base font-semibold" : "mt-2 text-sm font-semibold"}>{inline(h[2]!)}</div>);
    else if (l.trim()) out.push(<p key={out.length} className="my-1.5 leading-relaxed">{inline(l)}</p>);
  }
  flush();
  return <div className={className}>{out}</div>;
}

function inline(s: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<strong key={parts.length}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={parts.length} className="rounded bg-ink-100 px-1 text-[12px]">{t.slice(1, -1)}</code>);
    else parts.push(<em key={parts.length}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
