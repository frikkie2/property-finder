import { describe, it, expect } from "vitest";
import { parseListingHtml } from "@/lib/listing-extractor";
import fs from "fs";
import path from "path";

const fixturePath = path.join(__dirname, "../fixtures/property24-sample.html");
const sampleHtml = fs.readFileSync(fixturePath, "utf-8");

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
});
