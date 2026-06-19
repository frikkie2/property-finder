import type { ListingData, PropertyFingerprint } from "./types";
import { MODELS, listingImage, visionJson } from "./claude";

export function buildFeatureExtractionPrompt(listing: ListingData): string {
  const facts = [
    listing.bedrooms ? `${listing.bedrooms} bedrooms` : null,
    listing.bathrooms ? `${listing.bathrooms} bathrooms` : null,
    listing.parking ? `${listing.parking} garages/parking` : null,
    listing.plotSize ? `erf (stand) size ${listing.plotSize} m²` : null,
    listing.floorSize ? `floor size ${listing.floorSize} m²` : null,
    listing.propertyType ? `type: ${listing.propertyType}` : null,
  ].filter(Boolean).join(", ");

  return `You are analysing photos from a property listing (each labelled "Photo N").
The goal: build a fingerprint that lets us find this exact house in ${listing.listedSuburb || "a Pretoria suburb"} using satellite imagery and Google Street View.

LISTING FACTS: ${facts || "none"}
LISTING DESCRIPTION:
"""${listing.description || "(none)"}"""

Extract THREE things:

1. QUICK WINS — instant identification clues. OCR every photo: house numbers on walls/gates/letterboxes/curbs, street name signs, "For Sale" board phone numbers, visible business signs or landmarks (churches, schools, shops), water towers / hills / cell masts in the background. Mine the description for location clues ("corner stand", "opposite the school", "walking distance from X").

2. AERIAL SIGNATURE — what this stand looks like from DIRECTLY ABOVE on satellite imagery. Reason it out from the photos: roof shape/colour as seen from above (L/T/U/rectangular, wings), pool presence + shape + position relative to the house, stand size, driveway shape and surface, lapa/wendy house/outbuildings, big trees, solar panels/geysers on the roof, boundary walls. Use the erf size to estimate how big the stand looks. Note imagery may be a few years old — pools and roofs persist, gardens change.
IMPORTANT: the listing description is AUTHORITATIVE for hard features. If it mentions a swimming pool, jacuzzi, lapa, borehole, flatlet etc., include it in the aerial signature even when no photo shows it (agents often skip pool photos).

3. FACADE SIGNATURE — what this house looks like from THE STREET. Wall material and colour, roof type/colour, storeys, gate and fence style, garage door count/colour, window pattern, driveway, distinctive permanent features. Also state which photo numbers best show the street facade (front of house as visible from the road) — these will be compared against Street View. Exclude interior shots, back gardens and aerial shots.

Respond with ONLY valid JSON:
{
  "houseNumber": null | "string (only if actually visible in a photo)",
  "streetClue": null | "street name if visible/mentioned",
  "exteriorFinish": "face_brick|plaster|painted|mixed|unknown",
  "exteriorColour": null | "string",
  "roofType": "tiles|ibr_sheeting|thatch|concrete|unknown",
  "roofColour": null | "string",
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
  "aerial": {
    "roofShape": "string",
    "roofColour": null | "string",
    "poolPresent": boolean,
    "poolShape": "kidney|rectangle|freeform|round|none|unknown",
    "poolPosition": null | "string",
    "standSizeM2": null | number,
    "drivewayDescription": null | "string",
    "treeCover": null | "string",
    "outbuildings": ["string"],
    "distinctiveAerial": ["string — the few features that would single this stand out from above"],
    "summary": "one paragraph describing the stand exactly as a satellite would see it"
  },
  "facade": {
    "summary": "one paragraph describing the house exactly as Street View would see it from the road",
    "bestPhotoIndexes": [numbers, 1-indexed, best first, max 3]
  }
}`;
}

export function normalizeFingerprint(raw: Record<string, unknown>): PropertyFingerprint {
  const r = raw as any;
  return {
    houseNumber: r.houseNumber ?? null,
    streetClue: r.streetClue ?? null,
    exteriorFinish: r.exteriorFinish ?? "unknown",
    exteriorColour: r.exteriorColour ?? null,
    roofType: r.roofType ?? "unknown",
    roofColour: r.roofColour ?? null,
    storeys: r.storeys ?? 1,
    fenceType: r.fenceType ?? "unknown",
    garageCount: r.garageCount ?? 0,
    poolShape: r.poolShape ?? "unknown",
    drivewayType: r.drivewayType ?? "unknown",
    solarPanels: r.solarPanels ?? false,
    notableFeatures: r.notableFeatures ?? [],
    landmarks: r.landmarks ?? [],
    neighbourFeatures: r.neighbourFeatures ?? [],
    quickWins: r.quickWins ?? [],
    aerial: r.aerial ?? null,
    facade: r.facade ?? null,
  };
}

// Capped at 12: each photo is fetched server-side by Anthropic, and one slow
// images.prop24.com response can time out the whole request. 12 covers the
// facade/exterior shots that matter without overloading the fetch.
const MAX_PHOTOS = 12;

export async function extractFeaturesFromListing(listing: ListingData): Promise<PropertyFingerprint> {
  const photos = listing.photoUrls.slice(0, MAX_PHOTOS);
  if (photos.length === 0) {
    throw new Error("Listing has no photos to analyse");
  }

  // URL image sources: Anthropic's servers fetch images.prop24.com directly,
  // so this works even when the local network blocks that host.
  const raw = await visionJson<Record<string, unknown>>({
    model: MODELS.fingerprint,
    images: photos.map(listingImage),
    labels: photos.map((_, i) => `Photo ${i + 1}:`),
    prompt: buildFeatureExtractionPrompt(listing),
    maxTokens: 4096,
  });

  return normalizeFingerprint(raw);
}
