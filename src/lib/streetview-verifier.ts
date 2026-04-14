import type {
  PropertyFingerprint,
  TilePropertyMatch,
  Candidate,
  FeatureMatch,
  ConfidenceLevel,
} from "./types";
import { fetchStreetViewMultipleAngles, reverseGeocode } from "./google-maps";
import { analyseBase64ImageWithPrompt } from "./claude";
import { fetchSatelliteImage } from "./google-maps";
import { v4 as uuidv4 } from "uuid";

interface VerificationResult {
  overallScore: number;
  confidenceLevel: ConfidenceLevel;
  featureMatches: FeatureMatch[];
  explanation: string;
}

export function buildStreetViewComparisonPrompt(fingerprint: PropertyFingerprint): string {
  const expectedFeatures: string[] = [];

  if (fingerprint.exteriorFinish !== "unknown") {
    expectedFeatures.push(`exterior finish: ${fingerprint.exteriorFinish}${fingerprint.exteriorColour ? ` (${fingerprint.exteriorColour})` : ""}`);
  }
  if (fingerprint.roofType !== "unknown") {
    expectedFeatures.push(`roof: ${fingerprint.roofType}${fingerprint.roofColour ? ` (${fingerprint.roofColour})` : ""}`);
  }
  if (fingerprint.fenceType !== "unknown") {
    expectedFeatures.push(`fence/boundary: ${fingerprint.fenceType}`);
  }
  if (fingerprint.garageCount > 0) {
    expectedFeatures.push(`${fingerprint.garageCount} garage door(s)`);
  }
  expectedFeatures.push(`${fingerprint.storeys} storey(s)`);

  for (const feat of fingerprint.notableFeatures) {
    expectedFeatures.push(feat);
  }
  for (const neighbour of fingerprint.neighbourFeatures) {
    expectedFeatures.push(`neighbouring property: ${neighbour}`);
  }

  const featureList = expectedFeatures.map((f) => `- ${f}`).join("\n");

  return `You are comparing a Google Street View image with features extracted from a property listing. The listing property has these features:

${featureList}

Carefully examine the Street View image and score how well this property matches. Consider:
1. Structural features (roof, walls, storeys) are more reliable than cosmetic features (paint, garden)
2. Google Street View may be 1-5 years old — the property may have been renovated
3. Look at neighbouring properties too — they can confirm or deny a match

IMPORTANT: Be honest. If it doesn't match, say so. A false positive wastes the agent's time.

Respond with ONLY valid JSON:

{
  "overallScore": 0-100,
  "confidenceLevel": "high" | "medium" | "low",
  "featureMatches": [
    {"feature": "string", "matched": true/false, "source": "street_view" | "satellite" | "both", "notes": "string or null"}
  ],
  "explanation": "2-3 sentence explanation of why this is or isn't a match, noting any caveats about imagery age or renovations."
}`;
}

export function parseVerificationResponse(responseText: string): VerificationResult {
  let jsonStr = responseText.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const raw = JSON.parse(jsonStr);

  return {
    overallScore: raw.overallScore ?? 0,
    confidenceLevel: raw.confidenceLevel ?? "low",
    featureMatches: (raw.featureMatches ?? []).map((fm: any) => ({
      feature: fm.feature ?? "",
      matched: fm.matched ?? false,
      source: fm.source ?? "street_view",
      notes: fm.notes ?? null,
    })),
    explanation: raw.explanation ?? "",
  };
}

export async function verifyCandidate(
  match: TilePropertyMatch,
  fingerprint: PropertyFingerprint,
  listingId: string
): Promise<Candidate | null> {
  const streetViewImages = await fetchStreetViewMultipleAngles(
    match.estimatedLat,
    match.estimatedLng
  );

  if (streetViewImages.length === 0) return null;

  const satellite = await fetchSatelliteImage(match.estimatedLat, match.estimatedLng, 20);
  const address = await reverseGeocode(match.estimatedLat, match.estimatedLng);

  const bestImage = streetViewImages[0];
  const prompt = buildStreetViewComparisonPrompt(fingerprint);
  const response = await analyseBase64ImageWithPrompt(bestImage.base64, bestImage.mediaType, prompt);

  const verification = parseVerificationResponse(response);

  return {
    id: uuidv4(),
    listingId,
    address: address || `${match.estimatedLat.toFixed(6)}, ${match.estimatedLng.toFixed(6)}`,
    latitude: match.estimatedLat,
    longitude: match.estimatedLng,
    confidenceScore: verification.overallScore,
    confidenceLevel: verification.confidenceLevel,
    satelliteMatchScore: match.confidence === "high" ? 90 : match.confidence === "medium" ? 65 : 40,
    streetviewMatchScore: verification.overallScore,
    featureMatches: verification.featureMatches,
    aiExplanation: verification.explanation,
    streetviewImageUrl: `/api/images/${bestImage.key}`,
    satelliteImageUrl: `/api/images/${satellite.key}`,
    status: "pending",
    confirmedAt: null,
  };
}

export async function verifyCandidates(
  matches: TilePropertyMatch[],
  fingerprint: PropertyFingerprint,
  listingId: string,
  maxCandidates: number = 10,
  onProgress?: (verified: number, total: number) => void
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const toVerify = matches.slice(0, maxCandidates);

  for (let i = 0; i < toVerify.length; i++) {
    const candidate = await verifyCandidate(toVerify[i], fingerprint, listingId);

    if (candidate && candidate.confidenceScore > 20) {
      candidates.push(candidate);
    }

    if (onProgress) onProgress(i + 1, toVerify.length);
  }

  candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return candidates;
}
