"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { setTaskStatusAction } from "@/app/actions/ops";

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT", "WAITING_FOR_APPROVAL", "BLOCKED", "COMPLETED", "CANCELLED"];

export function TaskStatusSelect({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col">
      <select
        defaultValue={status}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            const r = await setTaskStatusAction(id, v);
            setErr(r?.ok === false ? r.error ?? "Failed" : null);
            router.refresh();
          });
        }}
        className="input h-8 w-auto py-1 text-xs"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
      </select>
      {err && <span className="mt-0.5 text-[10px] text-red-600">{err}</span>}
    </span>
  );
}
