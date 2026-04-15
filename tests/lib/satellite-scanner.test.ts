import { describe, it, expect } from "vitest";
import { generateTileGrid, buildSatelliteScanPrompt } from "@/lib/satellite-scanner";
import type { SuburbBounds, PropertyFingerprint } from "@/lib/types";

const testSuburb: SuburbBounds = {
  name: "TestSuburb",
  north: -25.720,
  south: -25.740,
  east: 28.230,
  west: 28.205,
};

describe("satellite scanner", () => {
  describe("generateTileGrid", () => {
    it("generates tiles covering the suburb bounds", () => {
      const tiles = generateTileGrid(testSuburb, 0.001);
      expect(tiles.length).toBeGreaterThan(0);

      for (const tile of tiles) {
        expect(tile.centerLat).toBeGreaterThanOrEqual(testSuburb.south);
        expect(tile.centerLat).toBeLessThanOrEqual(testSuburb.north);
        expect(tile.centerLng).toBeGreaterThanOrEqual(testSuburb.west);
        expect(tile.centerLng).toBeLessThanOrEqual(testSuburb.east);
      }
    });

    it("generates expected number of tiles for known dimensions (with 50% overlap)", () => {
      const tiles = generateTileGrid(testSuburb, 0.001);
      // With 50% overlap (default), tile count is roughly 4x higher than no overlap
      expect(tiles.length).toBeGreaterThan(1000);
      expect(tiles.length).toBeLessThan(3000);
    });

    it("generates fewer tiles with no overlap", () => {
      const noOverlap = generateTileGrid(testSuburb, 0.001, 0);
      const withOverlap = generateTileGrid(testSuburb, 0.001, 0.5);
      expect(withOverlap.length).toBeGreaterThan(noOverlap.length);
    });
  });

  describe("buildSatelliteScanPrompt", () => {
    it("includes fingerprint features in prompt", () => {
      const fingerprint: PropertyFingerprint = {
        houseNumber: null,
        streetClue: null,
        exteriorFinish: "face_brick",
        exteriorColour: "red-brown",
        roofType: "tiles",
        roofColour: "terracotta",
        storeys: 1,
        fenceType: "palisade",
        garageCount: 2,
        poolShape: "kidney",
        drivewayType: "straight",
        solarPanels: false,
        notableFeatures: ["large lapa"],
        landmarks: [],
        neighbourFeatures: [],
        quickWins: [],
      };

      const prompt = buildSatelliteScanPrompt(fingerprint);
      expect(prompt).toContain("terracotta");
      expect(prompt).toContain("kidney");
      expect(prompt).toContain("JSON");
    });
  });
});
