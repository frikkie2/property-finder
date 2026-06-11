import fs from "fs";
import path from "path";
import type { SuburbBounds } from "./types";

/**
 * Suburb boundaries.
 *
 * The original hand-drawn bounding boxes were all shifted 2–4 km west of the
 * real suburbs (the old "Silverton" box did not overlap Silverton at all),
 * which made every search scan the wrong patch of earth. These bounds come
 * from the Google Geocoding API (sublocality `geometry.bounds`, verified
 * 2026-06-11) and can be refreshed at runtime via `resolveSuburbBounds`.
 */
export const SUBURBS: SuburbBounds[] = [
  { name: "Silverton",    north: -25.7188, south: -25.7420, east: 28.3320, west: 28.2824 },
  { name: "Queenswood",   north: -25.7126, south: -25.7372, east: 28.2596, west: 28.2421 },
  { name: "Kilner Park",  north: -25.7097, south: -25.7358, east: 28.2691, west: 28.2572 },
  { name: "Weavind Park", north: -25.7282, south: -25.7358, east: 28.2760, west: 28.2625 },
  { name: "Capital Park", north: -25.7214, south: -25.7309, east: 28.2043, west: 28.1716 },
  { name: "Colbyn",       north: -25.7365, south: -25.7429, east: 28.2525, west: 28.2371 },
  { name: "Moregloed",    north: -25.7069, south: -25.7185, east: 28.2598, west: 28.2420 },
  { name: "Waverley",     north: -25.6926, south: -25.7112, east: 28.2697, west: 28.2415 },
  { name: "Villieria",    north: -25.6926, south: -25.7273, east: 28.2422, west: 28.2176 },
  { name: "Rietondale",   north: -25.7257, south: -25.7360, east: 28.2290, west: 28.2176 },
  { name: "Meyerspark",   north: -25.7347, south: -25.7463, east: 28.3296, west: 28.2999 },
];

// Adjacency for expand-on-demand searching
export const ADJACENCY: Record<string, string[]> = {
  "Silverton": ["Meyerspark", "Weavind Park"],
  "Queenswood": ["Rietondale", "Villieria", "Colbyn", "Moregloed", "Kilner Park"],
  "Kilner Park": ["Queenswood", "Moregloed", "Weavind Park"],
  "Weavind Park": ["Kilner Park", "Silverton"],
  "Capital Park": ["Villieria", "Rietondale"],
  "Colbyn": ["Rietondale", "Queenswood"],
  "Moregloed": ["Villieria", "Queenswood", "Kilner Park", "Waverley"],
  "Waverley": ["Moregloed", "Villieria"],
  "Villieria": ["Capital Park", "Queenswood", "Moregloed", "Waverley", "Rietondale"],
  "Rietondale": ["Capital Park", "Queenswood", "Colbyn", "Villieria"],
  "Meyerspark": ["Silverton"],
};

const BOUNDS_CACHE_FILE = path.join(process.cwd(), ".cache", "suburb-bounds.json");

/** Normalize a suburb name as scraped from a listing title (e.g. "Silverton, Pretoria"). */
export function normalizeSuburbName(raw: string): string | null {
  const cleaned = raw.split(/[,(-]/)[0].trim().toLowerCase();
  if (!cleaned) return null;
  const match = SUBURBS.find((s) => s.name.toLowerCase() === cleaned);
  if (match) return match.name;
  // Loose match: listing says "Silverton AH" / "Kilner Park Ext 2" etc.
  const loose = SUBURBS.find(
    (s) => cleaned.startsWith(s.name.toLowerCase()) || s.name.toLowerCase().startsWith(cleaned)
  );
  return loose ? loose.name : null;
}

/**
 * Resolve a suburb's bounding box: live Google Geocoding result when
 * available (cached to disk), otherwise the verified static table.
 */
export async function resolveSuburbBounds(name: string): Promise<SuburbBounds> {
  const staticEntry = SUBURBS.find((s) => s.name === name);

  // Disk cache first
  try {
    if (fs.existsSync(BOUNDS_CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(BOUNDS_CACHE_FILE, "utf-8"));
      if (cache[name]) return cache[name] as SuburbBounds;
    }
  } catch {
    // corrupt cache — ignore
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json?address=` +
        `${encodeURIComponent(`${name}, Pretoria, South Africa`)}&key=${apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const data = await response.json();
      const result = data.results?.[0];
      const isSuburb = result?.types?.includes("sublocality") || result?.types?.includes("neighborhood");
      const b = result?.geometry?.bounds;
      if (data.status === "OK" && isSuburb && b) {
        const bounds: SuburbBounds = {
          name,
          north: b.northeast.lat,
          south: b.southwest.lat,
          east: b.northeast.lng,
          west: b.southwest.lng,
        };
        try {
          fs.mkdirSync(path.dirname(BOUNDS_CACHE_FILE), { recursive: true });
          const cache = fs.existsSync(BOUNDS_CACHE_FILE)
            ? JSON.parse(fs.readFileSync(BOUNDS_CACHE_FILE, "utf-8"))
            : {};
          cache[name] = bounds;
          fs.writeFileSync(BOUNDS_CACHE_FILE, JSON.stringify(cache, null, 2));
        } catch {
          // cache write failure is non-fatal
        }
        return bounds;
      }
      console.warn(`[SUBURB] Geocode for "${name}" returned ${data.status}/${result?.types?.join(",")} — using static bounds`);
    } catch (err) {
      console.warn(`[SUBURB] Geocode failed for "${name}": ${(err as Error).message}`);
    }
  }

  if (!staticEntry) {
    throw new Error(
      `Unknown suburb "${name}" — not in the configured list and geocoding failed`
    );
  }
  return staticEntry;
}
