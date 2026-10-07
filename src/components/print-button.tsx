"use client";

export function PrintButton() {
  return <button type="button" className="btn-secondary btn-sm" onClick={() => window.print()}>Download PDF / Print</button>;
}
