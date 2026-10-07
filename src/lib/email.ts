import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transport: Transporter | null = null;

/**
 * Email delivery via SMTP (SMTP_URL, e.g. smtps://user:pass@smtp.postmarkapp.com:465).
 * Without SMTP_URL the platform runs email in Demo mode: messages are logged, not sent.
 */
export async function sendEmail(msg: { to: string | string[]; subject: string; text: string; html?: string }) {
  const to = Array.isArray(msg.to) ? msg.to.join(", ") : msg.to;
  if (!env.smtpUrl) {
    console.info(`[email:demo] to=${to} subject=${JSON.stringify(msg.subject)}`);
    return { delivered: false, mode: "DEMO" as const };
  }
  transport ??= nodemailer.createTransport(env.smtpUrl);
  await transport.sendMail({ from: env.emailFrom, to, subject: msg.subject, text: msg.text, html: msg.html });
  return { delivered: true, mode: "LIVE" as const };
}
