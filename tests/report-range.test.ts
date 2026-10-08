import { describe, expect, it } from "vitest";
import { resolveRange } from "@/lib/report-export";

describe("report date range filter", () => {
  it("defaults to the last 30 days", () => {
    const r = resolveRange(null);
    expect(Math.round((r.end.getTime() - r.start.getTime()) / 86_400_000)).toBe(30);
    expect(r.label).toBe("Last 30 days");
  });
  it("custom range includes the whole end day", () => {
    const r = resolveRange("custom", "2026-08-01", "2026-08-31");
    expect(r.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-08-31T23:59:59.999Z");
  });
  it("last month ends on the last day of the previous month", () => {
    const r = resolveRange("last_month");
    expect(r.start.getUTCDate()).toBe(1);
    expect(r.end.getUTCMonth()).toBe(r.start.getUTCMonth());
  });
  it("rejects invalid or oversized ranges", () => {
    expect(() => resolveRange("custom", "2026-09-01", "2026-08-01")).toThrow();
    expect(() => resolveRange("custom", "2024-01-01", "2026-01-01")).toThrow(/400/);
    expect(() => resolveRange("custom", "nope", "2026-01-01")).toThrow();
  });
});
