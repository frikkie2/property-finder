import type { PropertyFingerprint } from "./types";
import { analyseMultipleImagesWithPrompt } from "./claude";

export function buildFeatureExtractionPrompt(listingDescription: string): string {
  const descriptionSection = listingDescription
    ? `\n\nLISTING DESCRIPTION — extract ALL useful features, especially LOCATION clues like "corner stand", "opposite school", "near park", "facing north", "top of street":\n"${listingDescription}"\n`
    : "";

  return `You are analysing property listing photos to build a "property fingerprint" for identification from satellite and street view imagery.
${descriptionSection}
STEP 1 - CLASSIFY EACH PHOTO: First, classify each photo:
- FRONT_OF_HOUSE: the facade as seen from the street (this is CRITICAL — it's what Street View shows)
- STREET_VIEW: photos taken from the street looking at the property
- EXTERIOR_OTHER: garden, pool, back yard
- AERIAL: aerial/drone shots
- INTERIOR: kitchen, bedroom, bathroom, lounge (least useful)

CRITICAL: Identify the SINGLE BEST front-of-house photo — the one that shows the facade most clearly as it would appear from the street. Return its photo number (1-indexed) in the output.

STEP 2 - OCR / TEXT EXTRACTION (VERY IMPORTANT): Examine EVERY photo carefully for any visible text. Look for:
- House numbers on walls, gates, letterboxes, paving stones
- Street name signs in the background or foreground
- Business signs visible (shops, churches, schools nearby)
- Estate agent "For Sale" / "Sold" boards from previous listings
- Any numbers painted on curbs or driveway gates
- Address plates near doors

STEP 3 - QUICK WINS: Other instant-identification clues:
- A recognisable landmark (church, school, park, shopping centre)
- A clearly identifiable neighbouring property
- Mountain/hill views in background (can indicate direction)
- A specific geographic feature (river, reservoir)

STEP 3 - EXTERIOR FEATURES (from exterior photos):
- Exterior finish (face_brick / plaster / painted / mixed / unknown) and colour
- Roof type (tiles / ibr_sheeting / thatch / concrete / unknown) and colour
- Number of storeys
- Gate/fence type (palisade / wall / precast / face_brick / none / unknown)
- Number of garage doors and type
- Swimming pool shape (kidney / rectangle / freeform / round / none / unknown)
- Driveway type (circular / straight / double / none / unknown)
- Solar panels on roof (true/false)
- Notable external features (lapa, braai area, wendy house, water feature, etc)
- Any visible landmarks in background
- Any distinctive features of neighbouring properties

STEP 4 - ROOF/BUILDING OUTLINE (critical for satellite matching):
Estimate the approximate shape of the building as seen from above (bird's eye view). Describe:
- Overall roof shape: L-shaped, T-shaped, U-shaped, rectangular, square, irregular
- Approximate proportions (e.g., "long narrow rectangle with a wing to the right")
- Position of garage relative to main house
- Position of pool relative to house
- Any outbuildings (wendy house, lapa) and their position

Respond with ONLY valid JSON (no markdown, no explanation):

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
  "quickWins": [{"type": "house_number|street_sign|landmark|sold_board|neighbour_id", "value": "string", "confidence": "high|medium|low"}],
  "roofOutline": "description of building shape from above",
  "garagePosition": "left|right|center|detached|unknown",
  "poolPosition": "back-left|back-right|back-center|front|side|none",
  "photoClassification": {"frontOfHouse": number, "streetView": number, "exteriorOther": number, "aerial": number, "interior": number},
  "bestFrontOfHousePhotoIndex": number (1-indexed photo number that best shows the facade, or 0 if none),
  "locationClues": {
    "cornerStand": boolean,
    "nearSchool": boolean,
    "nearPark": boolean,
    "nearChurch": boolean,
    "nearShoppingCentre": boolean,
    "facing": "north|south|east|west|unknown",
    "topOfStreet": boolean,
    "cornerOfStreets": null or "Street1 & Street2",
    "otherClues": ["string"]
  },
  "visibleText": ["list all visible text from photos: signs, numbers, words"]
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
  photoUrls: string[],
  listingDescription: string = ""
): Promise<PropertyFingerprint> {
  const prompt = buildFeatureExtractionPrompt(listingDescription);

  // Send up to 20 photos at once (Claude can handle multiple images)
  const batch = photoUrls.slice(0, 20);
  const response = await analyseMultipleImagesWithPrompt(batch, prompt);

  return parseFeatureResponse(response);
}
