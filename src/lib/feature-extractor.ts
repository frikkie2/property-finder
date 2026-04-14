import type { PropertyFingerprint } from "./types";
import { analyseMultipleImagesWithPrompt } from "./claude";

export function buildFeatureExtractionPrompt(): string {
  return `You are analysing property listing photos to build a "property fingerprint" for identification purposes. Examine ALL photos carefully and extract every identifying feature you can find.

IMPORTANT: Look for "quick wins" first — these can identify the property instantly:
- A visible house number on a wall, gate, or letterbox
- A street name sign visible in any photo
- A recognisable landmark (church, school, park, shopping centre)
- A real estate "Sold" or "For Sale" board from a previous sale
- A clearly identifiable neighbouring property

Then extract all structural and visual features:

EXTERIOR: exterior finish (face_brick / plaster / painted / mixed / unknown), colour, roof type (tiles / ibr_sheeting / thatch / concrete / unknown), roof colour, number of storeys, gate/fence type (palisade / wall / precast / face_brick / none / unknown), number of garage doors.

PROPERTY: swimming pool shape (kidney / rectangle / freeform / round / none / unknown), driveway type (circular / straight / double / none / unknown), solar panels (true/false), notable features (lapa, braai area, wendy house, water feature, etc), any visible landmarks in background, any distinctive features of neighbouring properties.

Respond with ONLY valid JSON in this exact structure (no markdown, no explanation):

{
  "houseNumber": null or "string",
  "streetClue": null or "string",
  "exteriorFinish": "face_brick|plaster|painted|mixed|unknown",
  "exteriorColour": null or "string",
  "roofType": "tiles|ibr_sheeting|thatch|concrete|unknown",
  "roofColour": null or "string",
  "storeys": number,
  "fenceType": "palisade|wall|precast|face_brick|none|unknown",
  "garageCount": number,
  "poolShape": "kidney|rectangle|freeform|round|none|unknown",
  "drivewayType": "circular|straight|double|none|unknown",
  "solarPanels": boolean,
  "notableFeatures": ["string"],
  "landmarks": ["string"],
  "neighbourFeatures": ["string"],
  "quickWins": [{"type": "house_number|street_sign|landmark|sold_board|neighbour_id", "value": "string", "confidence": "high|medium|low"}]
}`;
}

export function parseFeatureResponse(responseText: string): PropertyFingerprint {
  // Strip markdown code blocks if present
  let jsonStr = responseText.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const raw = JSON.parse(jsonStr);

  return {
    houseNumber: raw.houseNumber ?? null,
    streetClue: raw.streetClue ?? null,
    exteriorFinish: raw.exteriorFinish ?? "unknown",
    exteriorColour: raw.exteriorColour ?? null,
    roofType: raw.roofType ?? "unknown",
    roofColour: raw.roofColour ?? null,
    storeys: raw.storeys ?? 1,
    fenceType: raw.fenceType ?? "unknown",
    garageCount: raw.garageCount ?? 0,
    poolShape: raw.poolShape ?? "unknown",
    drivewayType: raw.drivewayType ?? "unknown",
    solarPanels: raw.solarPanels ?? false,
    notableFeatures: raw.notableFeatures ?? [],
    landmarks: raw.landmarks ?? [],
    neighbourFeatures: raw.neighbourFeatures ?? [],
    quickWins: raw.quickWins ?? [],
  };
}

export async function extractFeaturesFromPhotos(
  photoUrls: string[]
): Promise<PropertyFingerprint> {
  const prompt = buildFeatureExtractionPrompt();

  // Send up to 20 photos at once (Claude can handle multiple images)
  const batch = photoUrls.slice(0, 20);
  const response = await analyseMultipleImagesWithPrompt(batch, prompt);

  return parseFeatureResponse(response);
}
