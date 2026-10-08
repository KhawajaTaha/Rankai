/**
 * SMS / WhatsApp delivery via Twilio's REST API (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * TWILIO_FROM, optional TWILIO_WHATSAPP_FROM). Without credentials, messages are logged (Demo Mode).
 */
export type Channel = "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP";

export const messagingLive = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

export async function sendSms(to: string, body: string, channel: "SMS" | "WHATSAPP" = "SMS") {
  const phone = normalizePhone(to);
  if (!phone) return { delivered: false, mode: "INVALID" as const };
  if (!messagingLive()) {
    console.info(`[${channel.toLowerCase()}:demo] to=${phone} ${JSON.stringify(body.slice(0, 80))}`);
    return { delivered: false, mode: "DEMO" as const };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const from = channel === "WHATSAPP" ? `whatsapp:${process.env.TWILIO_WHATSAPP_FROM ?? process.env.TWILIO_FROM}` : process.env.TWILIO_FROM!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: channel === "WHATSAPP" ? `whatsapp:${phone}` : phone, Body: body.slice(0, 1500) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { delivered: true, mode: "LIVE" as const };
}

/** E.164 normalisation (defaults to North American numbers when no country code is given). */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 11) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export const DEFAULT_PREFS: Record<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW", Channel[]> = {
  CRITICAL: ["IN_APP", "EMAIL"],
  HIGH: ["IN_APP"],
  MEDIUM: ["IN_APP"],
  LOW: ["IN_APP"],
};

export function channelsFor(prefs: unknown, severity: keyof typeof DEFAULT_PREFS): Channel[] {
  const p = (prefs ?? {}) as Partial<Record<string, Channel[]>>;
  const list = Array.isArray(p[severity]) ? p[severity]! : DEFAULT_PREFS[severity];
  return [...new Set<Channel>(["IN_APP", ...list.filter((c) => ["EMAIL", "SMS", "WHATSAPP"].includes(c))])];
}
