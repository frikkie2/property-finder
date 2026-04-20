import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { SuburbBounds } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "osm");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(query: string): string {
  return crypto.createHash("md5").update(query).digest("hex");
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

export interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

export interface OsmResponse {
  version: number;
  generator: string;
  elements: (OsmNode | OsmWay)[];
}

export interface Building {
  id: number;
  center: { lat: number; lng: number };
  polygon: { lat: number; lng: number }[];
  address?: string;
  houseNumber?: string;
  street?: string;
  buildingType?: string;
  levels?: number;
  areaMeters2: number;
}

/**
 * Fetch all buildings in a suburb's bounding box from OpenStreetMap.
 */
export async function fetchBuildingsInSuburb(suburb: SuburbBounds): Promise<Building[]> {
  const query = `
    [out:json][timeout:60];
    (
      way["building"](${suburb.south},${suburb.west},${suburb.north},${suburb.east});
    );
    out body;
    >;
    out skel qt;
  `;

  const key = cacheKey(`buildings-${suburb.name}-${query}`);
  const cached = getCached<Building[]>(key);
  if (cached) {
    console.log(`[OSM] Using cached buildings for ${suburb.name}: ${cached.length} buildings`);
    return cached;
  }

  console.log(`[OSM] Querying Overpass API for buildings in ${suburb.name}...`);

  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data: OsmResponse = await response.json();

  // Build a map of node IDs to coords
  const nodes = new Map<number, { lat: number; lng: number }>();
  for (const el of data.elements) {
    if (el.type === "node") {
      nodes.set(el.id, { lat: el.lat, lng: el.lon });
    }
  }

  // Convert building ways to Building objects
  const buildings: Building[] = [];
  for (const el of data.elements) {
    if (el.type !== "way" || !el.tags?.building) continue;

    const polygon = el.nodes
      .map((n) => nodes.get(n))
      .filter((p): p is { lat: number; lng: number } => p !== undefined);

    if (polygon.length < 3) continue;

    // Compute centroid and approximate area
    const centroid = computeCentroid(polygon);
    const area = approximatePolygonArea(polygon);

    const street = el.tags["addr:street"];
    const houseNumber = el.tags["addr:housenumber"];
    const address = houseNumber && street ? `${houseNumber} ${street}` : street || undefined;

    buildings.push({
      id: el.id,
      center: centroid,
      polygon,
      address,
      houseNumber,
      street,
      buildingType: el.tags["building"],
      levels: el.tags["building:levels"] ? parseInt(el.tags["building:levels"], 10) : undefined,
      areaMeters2: area,
    });
  }

  console.log(`[OSM] Found ${buildings.length} buildings in ${suburb.name}`);
  setCache(key, buildings);
  return buildings;
}

/**
 * Filter buildings to residential only (heuristic).
 */
export function filterResidentialBuildings(buildings: Building[]): Building[] {
  const residentialTypes = new Set([
    "yes", // Most residential buildings are just tagged "building=yes" in SA
    "residential",
    "house",
    "detached",
    "semidetached_house",
    "terrace",
    "bungalow",
    "apartments",
    "dormitory",
    "farm",
  ]);

  return buildings.filter((b) => {
    // Filter by building type
    if (!residentialTypes.has(b.buildingType || "yes")) return false;

    // Filter by size — typical residential plots: 50-500m² footprint
    // Too small = shed, too large = commercial/school
    if (b.areaMeters2 < 50) return false;
    if (b.areaMeters2 > 800) return false;

    return true;
  });
}

function computeCentroid(polygon: { lat: number; lng: number }[]): { lat: number; lng: number } {
  let sumLat = 0;
  let sumLng = 0;
  for (const p of polygon) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  return {
    lat: sumLat / polygon.length,
    lng: sumLng / polygon.length,
  };
}

/**
 * Approximate polygon area in square metres using the shoelace formula
 * converted to metres at this latitude.
 */
function approximatePolygonArea(polygon: { lat: number; lng: number }[]): number {
  // Shoelace formula in degrees
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].lng * polygon[j].lat;
    area -= polygon[j].lng * polygon[i].lat;
  }
  area = Math.abs(area) / 2;

  // Convert from square degrees to square metres
  // At Pretoria latitude (~-25.7), 1 degree ≈ 111km lat, 100km lng
  const metersPerDegreeLat = 111000;
  const metersPerDegreeLng = 100000;
  return area * metersPerDegreeLat * metersPerDegreeLng;
}
