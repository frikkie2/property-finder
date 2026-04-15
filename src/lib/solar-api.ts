import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache", "solar");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(lat: number, lng: number): string {
  return crypto.createHash("md5").update(`${lat.toFixed(6)},${lng.toFixed(6)}`).digest("hex");
}

function getCached<T>(key: string): T | null {
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function setCache(key: string, data: unknown) {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RoofSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  stats: {
    areaMeters2: number;
    sunshineQuantiles?: number[];
    groundAreaMeters2?: number;
  };
  center: LatLng;
  boundingBox: {
    sw: LatLng;
    ne: LatLng;
  };
  planeHeightAtCenterMeters?: number;
}

export interface BuildingInsights {
  name: string;
  center: LatLng;
  boundingBox: {
    sw: LatLng;
    ne: LatLng;
  };
  imageryDate: { year: number; month: number; day: number };
  postalCode?: string;
  administrativeArea?: string;
  statisticalArea?: string;
  regionCode?: string;
  solarPotential: {
    maxArrayPanelsCount?: number;
    maxArrayAreaMeters2?: number;
    wholeRoofStats?: {
      areaMeters2: number;
      groundAreaMeters2: number;
    };
    roofSegmentStats?: RoofSegment[];
    solarPanels?: Array<{
      center: LatLng;
      orientation: "LANDSCAPE" | "PORTRAIT";
      yearlyEnergyDcKwh: number;
      segmentIndex: number;
    }>;
  };
  imageryQuality: "HIGH" | "MEDIUM" | "LOW" | "UNSPECIFIED";
  imageryProcessedDate?: { year: number; month: number; day: number };
}

/**
 * Find the closest building to a lat/lng and return its insights.
 * Returns null if no building is found at that location.
 */
export async function findClosestBuilding(
  lat: number,
  lng: number
): Promise<BuildingInsights | null> {
  const key = cacheKey(lat, lng);
  const cached = getCached<BuildingInsights | null>(key);
  if (cached !== null) return cached;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest?` +
    `location.latitude=${lat}&location.longitude=${lng}` +
    `&requiredQuality=LOW&key=${apiKey}`;

  try {
    const response = await fetch(url);

    if (response.status === 404) {
      // No building found at this location — cache null to avoid re-querying
      setCache(key, null as unknown as BuildingInsights);
      return null;
    }

    if (!response.ok) {
      console.warn(`[SOLAR] API error ${response.status} for ${lat},${lng}`);
      return null;
    }

    const data: BuildingInsights = await response.json();
    setCache(key, data);
    return data;
  } catch (err) {
    console.warn("[SOLAR] Fetch error:", err);
    return null;
  }
}

/**
 * Summarise building shape for matching.
 */
export function summariseBuilding(building: BuildingInsights): {
  totalRoofArea: number;
  segmentCount: number;
  dominantAzimuth: number;
  hasSolarPanels: boolean;
  shapeComplexity: "simple" | "moderate" | "complex";
  roofShapeCategory: "gable" | "hip" | "flat" | "complex";
} {
  const segments = building.solarPotential?.roofSegmentStats || [];
  const totalRoofArea = building.solarPotential?.wholeRoofStats?.areaMeters2 || 0;
  const segmentCount = segments.length;

  // Most common azimuth (roughly the "facing" direction)
  const dominantAzimuth = segments.length > 0
    ? segments.reduce((best, s) => (s.stats.areaMeters2 > best.stats.areaMeters2 ? s : best), segments[0]).azimuthDegrees
    : 0;

  const hasSolarPanels = (building.solarPotential?.solarPanels?.length ?? 0) > 0;

  const shapeComplexity: "simple" | "moderate" | "complex" =
    segmentCount <= 2 ? "simple" : segmentCount <= 5 ? "moderate" : "complex";

  // Very rough roof shape classification
  let roofShapeCategory: "gable" | "hip" | "flat" | "complex";
  if (segments.length === 0) roofShapeCategory = "flat";
  else if (segments.length <= 2) roofShapeCategory = "gable";
  else if (segments.length <= 4) roofShapeCategory = "hip";
  else roofShapeCategory = "complex";

  return {
    totalRoofArea,
    segmentCount,
    dominantAzimuth,
    hasSolarPanels,
    shapeComplexity,
    roofShapeCategory,
  };
}
