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

  // Roof — most visible from satellite
  if (fingerprint.roofColour) features.push(`ROOF COLOUR: ${fingerprint.roofColour}`);
  if (fingerprint.roofType !== "unknown") features.push(`ROOF TYPE: ${fingerprint.roofType}`);
  const roofOutline = (fingerprint as any).roofOutline;
  if (roofOutline) features.push(`BUILDING SHAPE FROM ABOVE: ${roofOutline}`);

  // Pool — very visible from satellite
  if (fingerprint.poolShape !== "unknown" && fingerprint.poolShape !== "none") {
    const poolPos = (fingerprint as any).poolPosition;
    features.push(`SWIMMING POOL: ${fingerprint.poolShape}-shaped${poolPos && poolPos !== "none" ? `, positioned ${poolPos} of house` : ""}`);
  }

  // Driveway — visible from satellite
  if (fingerprint.drivewayType !== "unknown" && fingerprint.drivewayType !== "none") {
    features.push(`DRIVEWAY: ${fingerprint.drivewayType} driveway (look for paved area)`);
  }

  // Boundary walls/fences — visible as lines from satellite
  if (fingerprint.fenceType !== "unknown" && fingerprint.fenceType !== "none") {
    features.push(`BOUNDARY: ${fingerprint.fenceType} fence/wall (look for boundary lines)`);
  }

  // Garage position
  const garagePos = (fingerprint as any).garagePosition;
  if (fingerprint.garageCount > 0) {
    features.push(`GARAGE: ${fingerprint.garageCount}-car${garagePos && garagePos !== "unknown" ? `, positioned ${garagePos}` : ""}`);
  }

  // Solar panels — visible on roof
  if (fingerprint.solarPanels) features.push(`SOLAR PANELS visible on roof`);

  // Trees and garden features
  for (const feat of fingerprint.notableFeatures) {
    features.push(`FEATURE: ${feat}`);
  }

  const featureList = features.map((f) => `- ${f}`).join("\n");

  return `You are examining a satellite/aerial image of a residential area. Search for a SPECIFIC property that matches ALL of these features visible from above:

${featureList}

KEY IDENTIFICATION STRATEGY:
1. First look for the ROOF COLOUR and SHAPE — this is the most distinctive feature from satellite
2. Then check for a SWIMMING POOL of the right shape in the right position
3. Then check DRIVEWAY pattern and BOUNDARY WALLS
4. Then look for TREES and other external features
5. A property must match MOST features to be a candidate — don't flag weak matches

Be STRICT — only flag properties where at least 3 major features match. False positives waste time.

For each matching property, estimate its position as a lat/lng offset from the image center.

Respond with ONLY valid JSON (no markdown):

{
  "hasMatch": true/false,
  "matches": [
    {
      "estimatedLatOffset": number,
      "estimatedLngOffset": number,
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
  const { base64, mediaType } = await fetchSatelliteImage(tile.centerLat, tile.centerLng, 19);
  const prompt = buildSatelliteScanPrompt(fingerprint);

  const response = await analyseBase64ImageWithPrompt(base64, mediaType, prompt);

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
