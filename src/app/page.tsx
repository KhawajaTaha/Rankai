import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";

export default async function Home() {
  const ctx = await getCtx();
  redirect(!ctx ? "/login" : ctx.isClientUser ? "/portal" : "/dashboard");
}
