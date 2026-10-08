import { describe, expect, it } from "vitest";
import { channelsFor, normalizePhone } from "@/lib/messaging";
import { locationCity } from "@/lib/services/content";

describe("notification channels", () => {
  it("normalises phone numbers to E.164", () => {
    expect(normalizePhone("(807) 555-0100")).toBe("+18075550100");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555")).toBeNull();
  });
  it("always includes in-app and falls back to defaults", () => {
    expect(channelsFor(null, "CRITICAL")).toEqual(["IN_APP", "EMAIL"]);
    expect(channelsFor({ HIGH: ["SMS", "BOGUS"] }, "HIGH")).toEqual(["IN_APP", "SMS"]);
  });
});

describe("multi-location", () => {
  it("extracts the city from a GBP address", () => {
    expect(locationCity("120 Memorial Ave, Thunder Bay, ON")).toBe("Thunder Bay");
    expect(locationCity("55 Main St, Kenora")).toBe("Kenora");
    expect(locationCity("")).toBeNull();
  });
});
