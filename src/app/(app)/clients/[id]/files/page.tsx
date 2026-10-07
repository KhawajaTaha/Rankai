import { FileText } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { Badge, Card, EmptyState, fmtDate } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { uploadFileAction } from "@/app/actions/clients";

const CATS = ["Logo", "Brand Guidelines", "Contract", "Report", "Photo", "Screenshot", "Website Asset", "Document"];

export default async function ClientFiles({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cat?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  await getAccessibleClient(ctx, id);
  const files = await db.fileAsset.findMany({ where: { clientId: id, ...(sp.cat ? { category: sp.cat } : {}) }, orderBy: { createdAt: "desc" } });
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Files" className="lg:col-span-2" pad={false} actions={<form className="flex gap-1"><select name="cat" defaultValue={sp.cat ?? ""} className="input h-8 w-auto py-1 text-xs"><option value="">All categories</option>{CATS.map((c) => <option key={c}>{c}</option>)}</select><button className="btn-secondary btn-sm">Filter</button></form>}>
        <ul className="divide-y divide-ink-100">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-3">
              <FileText className="h-5 w-5 text-ink-400" />
              <div className="min-w-0 flex-1"><a href={f.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:text-brand-700">{f.name}</a><div className="text-xs text-ink-500">{(f.sizeBytes / 1024).toFixed(0)} KB · {fmtDate(f.createdAt)}</div></div>
              <Badge>{f.category}</Badge>{f.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}
              <Badge tone={f.clientVisible ? "teal" : "gray"}>{f.clientVisible ? "Client visible" : "Internal"}</Badge>
            </li>
          ))}
        </ul>
        {!files.length && <EmptyState icon={<FileText className="h-5 w-5" />} title="No files yet" />}
      </Card>
      {ctx.can("edit_client") && (
        <Card title="Upload file">
          <ActionForm action={uploadFileAction.bind(null, id)} className="space-y-3">
            <input name="file" type="file" className="input py-1.5 text-xs" />
            <Field label="Category"><select name="category" className="input">{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Tags"><input name="tags" className="input" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clientVisible" className="h-4 w-4 rounded" /> Visible in client portal</label>
            <SubmitButton>Upload</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
