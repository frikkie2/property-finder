import { describe, it, expect } from "vitest";
import { SUBURBS, ADJACENCY, normalizeSuburbName } from "@/lib/suburb-data";

describe("suburb data", () => {
  it("Silverton bounds contain the real suburb centre (the old box missed it entirely)", () => {
    const s = SUBURBS.find((x) => x.name === "Silverton")!;
    // OSM places Silverton's centre at -25.7283, 28.3047
    expect(s.west).toBeLessThan(28.3047);
    expect(s.east).toBeGreaterThan(28.3047);
    expect(s.south).toBeLessThan(-25.7283);
    expect(s.north).toBeGreaterThan(-25.7283);
  });

  it("all bounds are sane (north > south, east > west, Pretoria-ish)", () => {
    for (const s of SUBURBS) {
      expect(s.north).toBeGreaterThan(s.south);
      expect(s.east).toBeGreaterThan(s.west);
      expect(s.north).toBeLessThan(-25.6);
      expect(s.south).toBeGreaterThan(-25.8);
      expect(s.west).toBeGreaterThan(28.1);
      expect(s.east).toBeLessThan(28.4);
    }
  });

  it("adjacency is symmetric and references known suburbs", () => {
    const names = new Set(SUBURBS.map((s) => s.name));
    for (const [name, neighbours] of Object.entries(ADJACENCY)) {
      expect(names.has(name)).toBe(true);
      for (const n of neighbours) {
        expect(names.has(n)).toBe(true);
        expect(ADJACENCY[n]).toContain(name);
      }
    }
  });

  describe("normalizeSuburbName", () => {
    it("matches exact names case-insensitively", () => {
      expect(normalizeSuburbName("silverton")).toBe("Silverton");
      expect(normalizeSuburbName("Kilner Park")).toBe("Kilner Park");
    });
    it("strips trailing qualifiers", () => {
      expect(normalizeSuburbName("Silverton, Pretoria")).toBe("Silverton");
      expect(normalizeSuburbName("Meyerspark - Pretoria East")).toBe("Meyerspark");
    });
    it("returns null for unknown suburbs", () => {
      expect(normalizeSuburbName("Sandton")).toBeNull();
      expect(normalizeSuburbName("")).toBeNull();
    });
  });
});
