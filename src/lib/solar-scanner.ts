import type {
  SuburbBounds,
  PropertyFingerprint,
  TilePropertyMatch,
  ConfidenceLevel,
} from "./types";
import { findClosestBuilding, summariseBuilding, type BuildingInsights } from "./solar-api";

export type { BuildingInsights };

export interface ScoredBuilding {
  building: BuildingInsights;
  score: number;
  reasons: string[];
  confidence: ConfidenceLevel;
}

/**
 * Sample grid points across a suburb, find the nearest building to each, dedupe.
 * Grid resolution of ~30m gives good coverage for typical residential plots (~600-1000m²).
 */
export async function sampleBuildingsInSuburb(
  suburb: SuburbBounds,
  stepDegrees: number = 0.0006, // ~66m at this latitude — catches most residential plots (typical 600-1000m²)
  onProgress?: (sampled: number, total: number, found: number) => void
): Promise<BuildingInsights[]> {
  const buildings = new Map<string, BuildingInsights>();

  const latSteps = Math.ceil((suburb.north - suburb.south) / stepDegrees);
  const lngSteps = Math.ceil((suburb.east - suburb.west) / stepDegrees);
  const total = latSteps * lngSteps;

  // Build the full point list first
  const points: { lat: number; lng: number }[] = [];
  for (let i = 0; i < latSteps; i++) {
    for (let j = 0; j < lngSteps; j++) {
      points.push({
        lat: suburb.south + i * stepDegrees,
        lng: suburb.west + j * stepDegrees,
      });
    }
  }

  // Process in parallel batches
  const BATCH_SIZE = 10;
  let sampled = 0;

  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((p) => findClosestBuilding(p.lat, p.lng)));

    for (const building of results) {
      if (building && !buildings.has(building.name)) {
        buildings.set(building.name, building);
      }
    }

    sampled += batch.length;
    if (onProgress) {
      onProgress(sampled, total, buildings.size);
    }
  }

  return Array.from(buildings.values());
}

/**
 * Score a building against the property fingerprint.
 */
export function scoreBuildingAgainstFingerprint(
  building: BuildingInsights,
  fingerprint: PropertyFingerprint
): ScoredBuilding {
  const summary = summariseBuilding(building);
  const reasons: string[] = [];
  let score = 0;
  let maxScore = 0;

  // 1. Solar panels match (strong signal)
  if (fingerprint.solarPanels) {
    maxScore += 20;
    if (summary.hasSolarPanels) {
      score += 20;
      reasons.push("✓ Solar panels detected");
    } else {
      reasons.push("✗ No solar panels (expected)");
    }
  }

  // 2. Roof shape complexity — maps to outline from fingerprint
  const outline = (fingerprint as { roofOutline?: string }).roofOutline?.toLowerCase() || "";
  maxScore += 25;
  if (outline.includes("l-shaped") || outline.includes("l shape")) {
    if (summary.segmentCount >= 3 && summary.segmentCount <= 5) {
      score += 25;
      reasons.push(`✓ L-shape match (${summary.segmentCount} roof segments)`);
    } else {
      reasons.push(`~ Partial shape match`);
      score += 10;
    }
  } else if (outline.includes("rectangular") || outline.includes("rectangle")) {
    if (summary.segmentCount <= 2) {
      score += 25;
      reasons.push(`✓ Rectangular match (${summary.segmentCount} segments)`);
    } else {
      score += 8;
      reasons.push(`~ Shape partially matches`);
    }
  } else if (outline.includes("complex") || outline.includes("irregular")) {
    if (summary.segmentCount >= 5) {
      score += 25;
      reasons.push(`✓ Complex shape match`);
    }
  } else {
    // No outline info — give partial credit based on existing
    score += 10;
    reasons.push(`~ Roof has ${summary.segmentCount} segments`);
  }

  // 3. Number of storeys — use building height if available
  maxScore += 15;
  const totalArea = summary.totalRoofArea;
  // Typical single-storey house: 100-300m² roof; double-storey: 80-200m² with taller roof
  if (fingerprint.storeys === 1 && totalArea >= 80 && totalArea <= 400) {
    score += 15;
    reasons.push(`✓ Single-storey roof area matches (${Math.round(totalArea)}m²)`);
  } else if (fingerprint.storeys === 2 && totalArea >= 60 && totalArea <= 300) {
    score += 15;
    reasons.push(`✓ Double-storey compatible (${Math.round(totalArea)}m²)`);
  } else {
    score += 5;
    reasons.push(`~ Roof area: ${Math.round(totalArea)}m²`);
  }

  // 4. Imagery quality bonus (more reliable matches)
  maxScore += 5;
  if (building.imageryQuality === "HIGH") {
    score += 5;
    reasons.push(`✓ High-quality imagery`);
  }

  // Normalise to 0-100
  const normalisedScore = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  const confidence: ConfidenceLevel =
    normalisedScore >= 70 ? "high" : normalisedScore >= 45 ? "medium" : "low";

  return {
    building,
    score: normalisedScore,
    reasons,
    confidence,
  };
}

/**
 * Scan a suburb using Solar API, score all buildings, return top candidates
 * and all scored buildings (for debug/diagnostic display).
 */
export async function scanSuburbWithSolarApi(
  suburb: SuburbBounds,
  fingerprint: PropertyFingerprint,
  onProgress?: (sampled: number, total: number, found: number) => void,
  maxCandidates: number = 20
): Promise<{ matches: TilePropertyMatch[]; allScored: ScoredBuilding[]; buildings: BuildingInsights[] }> {
  console.log(`[SOLAR] Scanning ${suburb.name} via Solar API...`);

  const buildings = await sampleBuildingsInSuburb(suburb, 0.0006, onProgress);

  console.log(`[SOLAR] Found ${buildings.length} unique buildings in ${suburb.name}`);

  if (buildings.length === 0) {
    return { matches: [], allScored: [], buildings: [] };
  }

  // Score every building
  const scored = buildings.map((b) => scoreBuildingAgainstFingerprint(b, fingerprint));

  // Sort by score, keep top N
  scored.sort((a, b) => b.score - a.score);
  const topCandidates = scored.slice(0, maxCandidates);

  console.log(`[SOLAR] Top candidate score: ${topCandidates[0]?.score ?? 0}%`);

  // Convert to TilePropertyMatch format
  const matches = topCandidates.map((sc) => ({
    estimatedLat: sc.building.center.latitude,
    estimatedLng: sc.building.center.longitude,
    matchingFeatures: sc.reasons,
    confidence: sc.confidence,
  }));

  return { matches, allScored: scored, buildings };
}
