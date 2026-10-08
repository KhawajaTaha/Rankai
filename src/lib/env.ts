/** Centralised, typed access to configuration. Secrets never leave the server. */
export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  isProd: process.env.NODE_ENV === "production",
  /** "live" disables every demo fallback: no mock data is ever generated or shown. */
  live: process.env.APP_MODE === "live",
  runWorkerInProcess: (process.env.RUN_WORKER_IN_PROCESS ?? "true") === "true",
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  aiModel: process.env.AI_MODEL || "claude-opus-5-5",
  aiEffort: (process.env.AI_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  imageProvider: process.env.IMAGE_PROVIDER || "",
  imageApiKey: process.env.IMAGE_API_KEY || "",
  imageModel: process.env.IMAGE_MODEL || "gpt-image-1",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  serpProvider: process.env.SERP_PROVIDER || "",
  serpLogin: process.env.SERP_API_LOGIN || "",
  serpPassword: process.env.SERP_API_PASSWORD || "",
  smtpUrl: process.env.SMTP_URL || "",
  emailFrom: process.env.EMAIL_FROM || "Top Tech Digital.AI <no-reply@example.com>",
};

export const modes = {
  aiLive: () => Boolean(env.anthropicKey),
  imagesLive: () => Boolean(env.imageProvider && env.imageApiKey),
  googleLive: () => Boolean(env.googleClientId && env.googleClientSecret),
  serpLive: () => Boolean(env.serpProvider && env.serpLogin),
};
