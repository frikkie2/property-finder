import { describe, it, expect } from "vitest";
import { buildStreetViewComparisonPrompt, parseVerificationResponse } from "@/lib/streetview-verifier";
import type { PropertyFingerprint } from "@/lib/types";

describe("streetview verifier", () => {
  describe("buildStreetViewComparisonPrompt", () => {
    it("includes fingerprint features in comparison prompt", () => {
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
        neighbourFeatures: ["green roof next door"],
        quickWins: [],
      };

      const prompt = buildStreetViewComparisonPrompt(fingerprint);
      expect(prompt).toContain("face_brick");
      expect(prompt).toContain("palisade");
      expect(prompt).toContain("green roof next door");
      expect(prompt).toContain("JSON");
    });
  });

  describe("parseVerificationResponse", () => {
    it("parses a valid verification response", () => {
      const response = JSON.stringify({
        overallScore: 85,
        confidenceLevel: "high",
        featureMatches: [
          { feature: "terracotta roof", matched: true, source: "street_view", notes: null },
          { feature: "palisade fence", matched: true, source: "street_view", notes: null },
          { feature: "face brick", matched: true, source: "both", notes: "clearly visible" },
        ],
        explanation: "Strong match. The face brick facade and palisade fence match exactly.",
      });

      const result = parseVerificationResponse(response);
      expect(result.overallScore).toBe(85);
      expect(result.confidenceLevel).toBe("high");
      expect(result.featureMatches).toHaveLength(3);
      expect(result.explanation).toContain("Strong match");
    });

    it("handles markdown-wrapped JSON", () => {
      const response =
        "```json\n" +
        JSON.stringify({
          overallScore: 50,
          confidenceLevel: "medium",
          featureMatches: [],
          explanation: "Partial match.",
        }) +
        "\n```";

      const result = parseVerificationResponse(response);
      expect(result.overallScore).toBe(50);
    });
  });
});
