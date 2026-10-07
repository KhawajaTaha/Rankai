export function GridHeatmap({ points, size }: { points: { row: number; col: number; position: number | null }[]; size: number }) {
  const color = (p: number | null) => (p == null ? "bg-ink-300 text-white" : p <= 3 ? "bg-emerald-500 text-white" : p <= 6 ? "bg-lime-400 text-ink-900" : p <= 10 ? "bg-amber-400 text-ink-900" : p <= 15 ? "bg-orange-500 text-white" : "bg-red-500 text-white");
  const center = (size - 1) / 2;
  return (
    <div className="inline-grid gap-1.5 rounded-2xl bg-[radial-gradient(circle_at_center,#eef4ff,#f7f8fa)] p-3" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
      {points.sort((a, b) => a.row - b.row || a.col - b.col).map((p) => (
        <div key={`${p.row}-${p.col}`} title={p.position ? `Position ${p.position}` : "Not in top 20"} className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold shadow-sm ${color(p.position)} ${p.row === center && p.col === center ? "ring-2 ring-brand-600 ring-offset-2" : ""}`}>
          {p.position ?? "20+"}
        </div>
      ))}
    </div>
  );
}
