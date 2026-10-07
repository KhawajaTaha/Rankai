import { describe, expect, it } from "vitest";
import { decrypt, encrypt, encryptJson, decryptJson, hmacSha256, safeEqual } from "@/lib/crypto";
import { generateTotpSecret, totpCode, verifyTotp } from "@/lib/totp";
import { effectivePermissions, SYSTEM_ROLES } from "@/lib/permissions";

describe("credential encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("refresh-token");
    expect(a).not.toBe(encrypt("refresh-token"));
    expect(decrypt(a)).toBe("refresh-token");
    expect(decryptJson<{ x: number }>(encryptJson({ x: 1 }))).toEqual({ x: 1 });
  });
  it("detects tampering", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("produces the same HMAC as the WordPress connector formula", () => {
    const sig = hmacSha256("s3cret", "1700000000\nGET\n/wp-json/lsa/v1/status\n");
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(safeEqual(sig, hmacSha256("s3cret", "1700000000\nGET\n/wp-json/lsa/v1/status\n"))).toBe(true);
  });
});

describe("TOTP 2FA", () => {
  it("verifies current codes and rejects wrong ones", () => {
    const s = generateTotpSecret();
    expect(verifyTotp(s, totpCode(s))).toBe(true);
    expect(verifyTotp(s, "000000") && totpCode(s) !== "000000").toBe(false);
  });
});

describe("granular permissions", () => {
  it("applies grants and revokes on top of the role", () => {
    const p = effectivePermissions(SYSTEM_ROLES.support_agent.permissions, ["run_audit"], ["create_client"]);
    expect(p.has("run_audit")).toBe(true);
    expect(p.has("create_client")).toBe(false);
    expect(p.has("add_calls")).toBe(true);
  });
  it("support agents cannot see all clients or manage integrations", () => {
    const p = effectivePermissions(SYSTEM_ROLES.support_agent.permissions);
    expect(p.has("view_all_clients")).toBe(false);
    expect(p.has("manage_integrations")).toBe(false);
  });
  it("client roles only have portal permissions plus reports", () => {
    for (const k of ["client_owner", "client_staff"] as const) {
      for (const perm of SYSTEM_ROLES[k].permissions) expect(perm.startsWith("portal_") || perm === "view_reports").toBe(true);
    }
  });
});
