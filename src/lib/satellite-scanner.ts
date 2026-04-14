import type {
  SuburbBounds,
  SuburbZone,
  PropertyFingerprint,
  TileBounds,
  SatelliteTileResult,
  TilePropertyMatch,
} from "./types";
import { fetchSatelliteImage } from "./google-maps";
import { analyseBase64ImageWithPrompt } from "./claude";

export function generateTileGrid(
  suburb: SuburbBounds,
  stepDegrees: number = 0.001
): TileBounds[] {
  const tiles: TileBounds[] = [];
  const halfStep = stepDegrees / 2;

  for (let lat = suburb.south + halfStep; lat <= suburb.north; lat += stepDegrees) {
    for (let lng = suburb.west + halfStep; lng <= suburb.east; lng += stepDegrees) {
      tiles.push({
        north: lat + halfStep,
        south: lat - halfStep,
        east: lng + halfStep,
        west: lng - halfStep,
        centerLat: lat,
        centerLng: lng,
      });
    }
  }

  return tiles;
}

export function buildSatelliteScanPrompt(fingerprint: PropertyFingerprint): string {
  const features: string[] = [];

  if (fingerprint.roofColour) features.push(`${fingerprint.roofColour} roof`);
  if (fingerprint.roofType !== "unknown") features.push(`${fingerprint.roofType} roof type`);
  if (fingerprint.poolShape !== "unknown" && fingerprint.poolShape !== "none") {
    features.push(`${fingerprint.poolShape}-shaped swimming pool`);
  }
  if (fingerprint.drivewayType !== "unknown" && fingerprint.drivewayType !== "none") {
    features.push(`${fingerprint.drivewayType} driveway`);
  }
  if (fingerprint.solarPanels) features.push("solar panels on roof");
  if (fingerprint.garageCount > 0) features.push(`${fingerprint.garageCount}-car garage structure`);

  for (const feat of fingerprint.notableFeatures) {
    features.push(feat);
  }

  const featureList = features.map((f) => `- ${f}`).join("\n");

  return `You are examining a satellite/aerial image of residential properties. Look for ANY property in this image that matches these features:

${featureList}

For each property that could be a match, estimate its position within the image (as approximate latitude/longitude offset from center) and list which features match.

Respond with ONLY valid JSON (no markdown, no explanation):

{
  "hasMatch": true/false,
  "matches": [
    {
      "estimatedLatOffset": number (positive = north of center, negative = south),
      "estimatedLngOffset": number (positive = east of center, negative = west),
      "matchingFeatures": ["feature1", "feature2"],
      "confidence": "high" | "medium" | "low"
    }
  ]
}

If no properties match, return: {"hasMatch": false, "matches": []}`;
}

export async function scanTile(
  tile: TileBounds,
  fingerprint: PropertyFingerprint
): Promise<SatelliteTileResult> {
  const { base64 } = await fetchSatelliteImage(tile.centerLat, tile.centerLng, 19);
  const prompt = buildSatelliteScanPrompt(fingerprint);

  const response = await analyseBase64ImageWithPrompt(base64, "image/jpeg", prompt);

  let parsed;
  try {
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    parsed = JSON.parse(jsonStr);
  } catch {
    return { tile, hasMatch: false, matchedProperties: [] };
  }

  if (!parsed.hasMatch || !parsed.matches?.length) {
    return { tile, hasMatch: false, matchedProperties: [] };
  }

  const matchedProperties: TilePropertyMatch[] = parsed.matches.map(
    (m: any) => ({
      estimatedLat: tile.centerLat + (m.estimatedLatOffset || 0),
      estimatedLng: tile.centerLng + (m.estimatedLngOffset || 0),
      matchingFeatures: m.matchingFeatures || [],
      confidence: m.confidence || "low",
    })
  );

  return { tile, hasMatch: true, matchedProperties };
}

export async function scanSuburbZones(
  zones: SuburbZone[],
  fingerprint: PropertyFingerprint,
  onProgress?: (scanned: number, total: number, suburb: string) => void
): Promise<TilePropertyMatch[]> {
  const allMatches: TilePropertyMatch[] = [];

  for (const zone of zones) {
    const tiles = generateTileGrid(zone.suburb);
    let scanned = 0;

    for (const tile of tiles) {
      const result = await scanTile(tile, fingerprint);

      if (result.hasMatch) {
        allMatches.push(...result.matchedProperties);
      }

      scanned++;
      if (onProgress) {
        onProgress(scanned, tiles.length, zone.suburb.name);
      }
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  allMatches.sort((a, b) => order[a.confidence] - order[b.confidence]);

  return allMatches;
}
