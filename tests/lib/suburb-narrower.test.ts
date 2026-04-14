import { describe, it, expect } from "vitest";
import { getSuburbByName, getAdjacentSuburbs, narrowSuburbs } from "@/lib/suburb-narrower";
import { SUBURBS } from "@/lib/suburb-data";
import type { PropertyFingerprint, ListingData } from "@/lib/types";

describe("suburb narrower", () => {
  it("finds a suburb by name (case insensitive)", () => {
    const suburb = getSuburbByName("queenswood");
    expect(suburb).toBeTruthy();
    expect(suburb!.name).toBe("Queenswood");
  });

  it("returns null for unknown suburb", () => {
    expect(getSuburbByName("Atlantis")).toBeNull();
  });

  it("returns adjacent suburbs for Queenswood", () => {
    const adjacent = getAdjacentSuburbs("Queenswood");
    expect(adjacent.length).toBeGreaterThan(0);
    const names = adjacent.map((s) => s.name);
    expect(names).toContain("Colbyn");
    expect(names).toContain("Rietondale");
  });

  it("narrows to listed suburb + adjacent, prioritising listed suburb", () => {
    const listing = { listedSuburb: "Queenswood" } as ListingData;
    const fingerprint = { poolShape: "kidney" } as PropertyFingerprint;

    const zones = narrowSuburbs(listing, fingerprint);
    expect(zones.length).toBeGreaterThan(1);
    expect(zones[0].suburb.name).toBe("Queenswood");
    expect(zones[0].priority).toBe(1);
    expect(zones.slice(1).every((z) => z.priority === 2)).toBe(true);
  });

  it("all 12 suburbs are defined", () => {
    expect(SUBURBS).toHaveLength(12);
  });
});
