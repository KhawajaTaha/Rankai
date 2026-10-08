import crypto from "node:crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) for optional two-factor authentication.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, time = Date.now(), step = 30): string {
  const counter = Math.floor(time / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const clean = code.replace(/\s/g, "");
  for (let w = -window; w <= window; w++) {
    if (totpCode(secret, Date.now() + w * 30_000) === clean) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, email: string, issuer = "Top Tech Digital.AI"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
