import { describe, it, expect } from "vitest";
import { parseListingHtml } from "@/lib/listing-extractor";
import fs from "fs";
import path from "path";

const fixturePath = path.join(__dirname, "../fixtures/property24-sample.html");
const sampleHtml = fs.readFileSync(fixturePath, "utf-8");

const liveFixturePath = path.join(__dirname, "../fixtures/property24-live-2026.html");
const liveHtml = fs.readFileSync(liveFixturePath, "utf-8");

describe("listing extractor", () => {
  describe("parseListingHtml", () => {
    it("extracts suburb from title", () => {
      const result = parseListingHtml(sampleHtml, "https://property24.com/test");
      expect(result.listedSuburb).toBe("Queenswood");
    });

    it("extracts price as a number", () => {
      const result = parseListingHtml(sampleHtml, "https://property24.com/test");
      expect(result.price).toBe(2450000);
    });

    it("extracts bedroom and bathroom counts", () => {
      const result = parseListingHtml(sampleHtml, "https://property24.com/test");
      expect(result.bedrooms).toBe(3);
      expect(result.bathrooms).toBe(2);
    });

    it("extracts photo URLs", () => {
      const result = parseListingHtml(sampleHtml, "https://property24.com/test");
      expect(result.photoUrls.length).toBeGreaterThanOrEqual(1);
      expect(result.photoUrls[0]).toContain("prop24.com");
    });

    it("extracts description text", () => {
      const result = parseListingHtml(sampleHtml, "https://property24.com/test");
      expect(result.description).toContain("Beautiful family home");
    });

    it("extracts agent and agency", () => {
      const result = parseListingHtml(sampleHtml, "https://property24.com/test");
      expect(result.agentName).toBe("John Smith");
      expect(result.agencyName).toBe("RE/MAX Example");
    });
  });

  describe("parseListingHtml against real 2026 Property24 page", () => {
    const result = parseListingHtml(liveHtml, "https://property24.com/live-test");

    it("extracts the suburb", () => {
      expect(result.listedSuburb).toBe("Silverton");
    });

    it("extracts the FULL description including the pool sentence (not the truncated meta tag)", () => {
      expect(result.description).toContain("swimming pool and jacuzzi");
      expect(result.description).not.toContain("Property24.com");
    });

    it("extracts erf size from the feature icons", () => {
      expect(result.plotSize).toBe(1500);
    });

    it("extracts bedrooms and bathrooms from the feature icons", () => {
      expect(result.bedrooms).toBe(4);
      expect(result.bathrooms).toBe(2);
    });

    it("extracts a sensible number of deduplicated photo URLs", () => {
      expect(result.photoUrls.length).toBeGreaterThanOrEqual(10);
      expect(result.photoUrls.length).toBeLessThanOrEqual(60);
      // No duplicate photo IDs
      const ids = result.photoUrls.map((u) => u.match(/(\d{6,})/)?.[1]);
      expect(new Set(ids).size).toBe(ids.length);
      // Agent headshot (UpperCrop variant id 380166663) must not be included
      expect(result.photoUrls.some((u) => u.includes("380166663"))).toBe(false);
    });
  });
});
