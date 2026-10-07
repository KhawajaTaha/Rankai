import { Tabs } from "./ui";

export function SupportNav({ active, manager }: { active: string; manager: boolean }) {
  return (
    <div className="mb-5">
      <Tabs active={active} tabs={[{ href: "/support", label: "Overview" }, { href: "/support/calls", label: "Calls" }, { href: "/support/follow-ups", label: "Follow-Ups" }, { href: "/support/tickets", label: "Client Requests" }, { href: "/support/notes", label: "Notes" }, ...(manager ? [{ href: "/support/performance", label: "Performance" }] : [])]} />
    </div>
  );
}
