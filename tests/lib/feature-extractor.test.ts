import { describe, it, expect } from "vitest";
import { buildFeatureExtractionPrompt, parseFeatureResponse } from "@/lib/feature-extractor";
import fs from "fs";
import path from "path";

const sampleFingerprint = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/sample-fingerprint.json"), "utf-8")
);

describe("feature extractor", () => {
  describe("buildFeatureExtractionPrompt", () => {
    it("returns a non-empty prompt string", () => {
      const prompt = buildFeatureExtractionPrompt("");
      expect(prompt).toBeTruthy();
      expect(prompt).toContain("House numbers");
      expect(prompt).toContain("roof");
      expect(prompt).toContain("Swimming pool");
      expect(prompt).toContain("JSON");
      expect(prompt).toContain("EXTERIOR");
      expect(prompt).toContain("INTERIOR");
      expect(prompt).toContain("roofOutline");
    });

    it("includes listing description in prompt when provided", () => {
      const prompt = buildFeatureExtractionPrompt("Face brick home with large pool and lapa");
      expect(prompt).toContain("Face brick home with large pool and lapa");
    });
  });

  describe("parseFeatureResponse", () => {
    it("parses a valid JSON response into a PropertyFingerprint", () => {
      const jsonStr = JSON.stringify(sampleFingerprint);
      const result = parseFeatureResponse(jsonStr);
      expect(result.exteriorFinish).toBe("face_brick");
      expect(result.roofType).toBe("tiles");
      expect(result.poolShape).toBe("kidney");
      expect(result.garageCount).toBe(2);
    });

    it("handles JSON wrapped in markdown code blocks", () => {
      const wrapped = "```json\n" + JSON.stringify(sampleFingerprint) + "\n```";
      const result = parseFeatureResponse(wrapped);
      expect(result.exteriorFinish).toBe("face_brick");
    });

    it("provides defaults for missing fields", () => {
      const minimal = JSON.stringify({ roofType: "tiles" });
      const result = parseFeatureResponse(minimal);
      expect(result.roofType).toBe("tiles");
      expect(result.exteriorFinish).toBe("unknown");
      expect(result.poolShape).toBe("unknown");
      expect(result.storeys).toBe(1);
      expect(result.quickWins).toEqual([]);
    });
  });
});
