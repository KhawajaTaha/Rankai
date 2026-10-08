import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env, modes } from "../env";
import { NotConfiguredError } from "../errors";

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 3 });
  return client;
}

export class AiRefusalError extends Error {}

export interface AiResult<T> {
  data: T;
  mode: "LIVE" | "DEMO";
  model: string;
}

/**
 * Generate structured JSON validated against a zod schema.
 * LIVE: Claude with structured outputs (output_config.format = json_schema) and server-side
 *       refusal fallbacks enabled. DEMO: the deterministic `fallback` generator is used so the
 *       platform is fully usable without credentials — always reported as mode "DEMO".
 */
export async function generateStructured<S extends z.ZodTypeAny>(args: {
  system: string;
  prompt: string;
  schema: S;
  fallback: () => z.infer<S>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** The fallback is computed from real data (not template content) and may be used in live mode. */
  rulesFallbackOk?: boolean;
}): Promise<AiResult<z.infer<S>>> {
  if (!modes.aiLive()) {
    if (env.live && !args.rulesFallbackOk) throw new NotConfiguredError("AI");
    return { data: args.schema.parse(args.fallback()), mode: "DEMO", model: "demo-generator" };
  }

  const jsonSchema = z.toJSONSchema(args.schema, { target: "draft-7" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const response = await anthropic().beta.messages.create({
    model: env.aiModel,
    max_tokens: args.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: args.system,
    output_config: { effort: args.effort ?? env.aiEffort, format: { type: "json_schema", schema: jsonSchema } },
    messages: [{ role: "user", content: args.prompt }],
  });
  if (response.stop_reason === "refusal") throw new AiRefusalError("The AI declined to generate this content");
  if (response.stop_reason === "max_tokens") throw new Error("AI output was truncated (max_tokens)");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = args.schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`AI output failed validation: ${parsed.error.message.slice(0, 300)}`);
  return { data: parsed.data, mode: "LIVE", model: response.model };
}

/** Free-text generation (assistants, summaries). */
export async function generateText(args: {
  system: string;
  prompt: string;
  fallback: () => string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<AiResult<string>> {
  // Fallbacks here are rule-based answers computed from the client's real data, so they are allowed in live mode.
  if (!modes.aiLive()) return { data: args.fallback(), mode: "DEMO", model: "rules-engine" };
  const response = await anthropic().beta.messages.create({
    model: env.aiModel,
    max_tokens: args.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: args.system,
    output_config: { effort: args.effort ?? "low" },
    messages: [{ role: "user", content: args.prompt }],
  });
  if (response.stop_reason === "refusal") throw new AiRefusalError("The AI declined to answer this request");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  return { data: text, mode: "LIVE", model: response.model };
}
