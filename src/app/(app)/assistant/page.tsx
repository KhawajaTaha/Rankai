import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { modes } from "@/lib/env";
import { Card, PageHeader } from "@/components/ui";
import { AssistantPanel } from "@/components/assistant";
import { agencyAssistantAction } from "@/app/actions/ops";

export const metadata = { title: "AI Assistant" };

export default async function AgencyAssistant() {
  const ctx = await requireStaff();
  if (!ctx.can("use_agency_assistant")) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Agency AI Assistant" subtitle="Ask about any client you have access to. It can also create tasks for at-risk clients." />
      <Card>
        <AssistantPanel action={agencyAssistantAction} mode={modes.aiLive() ? "LIVE" : "DEMO"} placeholder="Ask about your clients, team or workload…" suggestions={["Which clients need attention?", "Show clients with no GBP posts this week.", "Which clients have ranking drops?", "Which support agents have overdue follow-ups?", "Generate tasks for all critical clients.", "Which clients are not fully onboarded?"]} />
      </Card>
    </div>
  );
}
