import { describe, it, expect } from "vitest";
import {
  lngToWorldX,
  latToWorldY,
  worldXToLng,
  worldYToLat,
  tilePixelToLatLng,
  metersPerImagePixel,
  generateSweepTiles,
  dedupeCandidates,
} from "@/lib/tile-sweep";
import { bearingBetween, haversineMeters } from "@/lib/google-maps";
import type { SweepCandidate } from "@/lib/types";

describe("Web Mercator math", () => {
  it("roundtrips lng -> worldX -> lng", () => {
    for (const lng of [-180, -25.5, 0, 28.3047, 179.9]) {
      expect(worldXToLng(lngToWorldX(lng))).toBeCloseTo(lng, 9);
    }
  });

  it("roundtrips lat -> worldY -> lat", () => {
    for (const lat of [-60, -25.7283, 0, 45, 70]) {
      expect(worldYToLat(latToWorldY(lat))).toBeCloseTo(lat, 9);
    }
  });

  it("centre pixel of a tile maps to the tile centre", () => {
    const pos = tilePixelToLatLng(-25.7283, 28.3047, 640, 640);
    expect(pos.lat).toBeCloseTo(-25.7283, 6);
    expect(pos.lng).toBeCloseTo(28.3047, 6);
  });

  it("pixel offsets map to the expected ground distance", () => {
    const mpp = metersPerImagePixel(-25.7283);
    // 100px to the right of centre should be ~100*mpp metres east
    const pos = tilePixelToLatLng(-25.7283, 28.3047, 740, 640);
    const dist = haversineMeters(-25.7283, 28.3047, pos.lat, pos.lng);
    expect(dist).toBeCloseTo(100 * mpp, 0);
    expect(pos.lng).toBeGreaterThan(28.3047); // east
    expect(pos.lat).toBeCloseTo(-25.7283, 6); // same latitude
  });

  it("y increases southward (top of image is north)", () => {
    const north = tilePixelToLatLng(-25.7283, 28.3047, 640, 100);
    const south = tilePixelToLatLng(-25.7283, 28.3047, 640, 1180);
    expect(north.lat).toBeGreaterThan(south.lat);
  });

  it("ground resolution at Pretoria is ~0.27 m/px", () => {
    expect(metersPerImagePixel(-25.73)).toBeGreaterThan(0.25);
    expect(metersPerImagePixel(-25.73)).toBeLessThan(0.29);
  });
});

describe("generateSweepTiles", () => {
  const silverton = { name: "Silverton", north: -25.7188, south: -25.742, east: 28.332, west: 28.2824 };

  it("covers the whole bounding box", () => {
    const tiles = generateSweepTiles(silverton);
    expect(tiles.length).toBeGreaterThan(20);
    const lats = tiles.map((t) => t.centerLat);
    const lngs = tiles.map((t) => t.centerLng);
    // Tiles span ~344m each side; centres must reach within one tile of every edge
    expect(Math.min(...lats)).toBeLessThan(silverton.south + 0.0035);
    expect(Math.max(...lats)).toBeGreaterThan(silverton.north - 0.0035);
    expect(Math.min(...lngs)).toBeLessThan(silverton.west + 0.004);
    expect(Math.max(...lngs)).toBeGreaterThan(silverton.east - 0.004);
  });

  it("keeps tile count practical (< 200 for a large suburb)", () => {
    expect(generateSweepTiles(silverton).length).toBeLessThan(200);
  });
});

describe("dedupeCandidates", () => {
  it("merges candidates within ~28m keeping the higher confidence", () => {
    const base: SweepCandidate = {
      lat: -25.7283, lng: 28.3047, confidence: "low", matchedFeatures: [], tileKey: "a",
    };
    const near: SweepCandidate = {
      ...base, lat: -25.72832, lng: 28.30472, confidence: "high", tileKey: "b",
    };
    const far: SweepCandidate = { ...base, lat: -25.7295, lng: 28.3047, tileKey: "c" };
    const result = dedupeCandidates([base, near, far]);
    expect(result).toHaveLength(2);
    expect(result[0].confidence).toBe("high");
  });
});

describe("bearingBetween", () => {
  it("computes cardinal bearings", () => {
    expect(bearingBetween(-25.73, 28.3, -25.72, 28.3)).toBeCloseTo(0, 0);   // north
    expect(bearingBetween(-25.73, 28.3, -25.73, 28.31)).toBeCloseTo(90, 0); // east
    expect(bearingBetween(-25.73, 28.3, -25.74, 28.3)).toBeCloseTo(180, 0); // south
    expect(bearingBetween(-25.73, 28.3, -25.73, 28.29)).toBeCloseTo(270, 0);// west
  });
});
