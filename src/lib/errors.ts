/**
 * Raised in live mode when a job needs an integration that has no credentials.
 * Live mode never falls back to mock data; the runner turns this into a single
 * deduplicated "configure X" alert instead of retries and task spam.
 */
export class NotConfiguredError extends Error {
  constructor(public integration: "AI" | "GOOGLE" | "IMAGES" | "SERP" | "SMTP" | "TWILIO", message?: string) {
    super(message ?? `${integration} integration is not configured`);
    this.name = "NotConfiguredError";
  }
}

export const INTEGRATION_HELP: Record<NotConfiguredError["integration"], { label: string; env: string }> = {
  AI: { label: "AI (Anthropic Claude)", env: "ANTHROPIC_API_KEY" },
  GOOGLE: { label: "Google OAuth (GBP, Search Console, GA4)", env: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET" },
  IMAGES: { label: "AI image generation", env: "IMAGE_PROVIDER / IMAGE_API_KEY" },
  SERP: { label: "Rank tracking (DataForSEO)", env: "SERP_PROVIDER / SERP_API_LOGIN / SERP_API_PASSWORD" },
  SMTP: { label: "Email (SMTP)", env: "SMTP_URL" },
  TWILIO: { label: "SMS / WhatsApp (Twilio)", env: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM" },
};
