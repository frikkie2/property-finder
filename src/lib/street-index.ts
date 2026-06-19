import fs from "fs";
import path from "path";
import crypto from "crypto";
import { geocodeAddress, fetchStreetViewAimedAt, haversineMeters } from "./google-maps";
import { MODELS, base64Image, listingImage, mapWithConcurrency, visionJson, type ImageInput } from "./claude";
import type { ListingData, PropertyFingerprint } from "./types";

/**
 * Street-level facade index.
 *
 * Instead of sweeping satellite imagery (weak signal, hidden by trees), we
 * decode a street the way an estate agent does: walk it in Street View,
 * house by house, and record what each facade looks like. Matching a listing
 * then becomes a direct facade comparison against this index — the strong,
 * discriminating signal. Built once per street, cheap to query thereafter.
 */

export interface IndexedHouse {
  address: string;
  houseNumber: string;
  lat: number;
  lng: number;
  svKey: string;        // cached Street View image (served via /api/images/<key>)
  svDate: string | null;
  facade: string;       // one-paragraph description of the street-facing facade
  features: string[];   // distinctive permanent features
}

export interface StreetIndex {
  street: string;
  suburb: string;
  slug: string;
  builtAt: string;
  houseCount: number;
  houses: IndexedHouse[];
}

const INDEX_DIR = path.join(process.cwd(), ".cache", "street-index");

export function streetSlug(street: string, suburb: string): string {
  return `${street}-${suburb}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function loadStreetIndex(slug: string): StreetIndex | null {
  const file = path.join(INDEX_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as StreetIndex;
  } catch {
    return null;
  }
}

export function listStreetIndexes(): StreetIndex[] {
  if (!fs.existsSync(INDEX_DIR)) return [];
  return fs
    .readdirSync(INDEX_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadStreetIndex(f.replace(/\.json$/, "")))
    .filter((x): x is StreetIndex => x !== null);
}

interface FacadeReply {
  facade: string;
  features: string[];
  isHouse: boolean;
}

/**
 * Build (or rebuild) the facade index for a street.
 *
 * Enumerates house numbers, geocodes each to a point on the street, fetches an
 * aimed Street View image, and has the model describe the facade. Numbers that
 * don't geocode onto the target street (or have no Street View) are skipped.
 */
export async function buildStreetIndex(
  street: string,
  suburb: string,
  opts: { maxNumber?: number; onProgress?: (done: number, total: number, kept: number) => void } = {}
): Promise<StreetIndex> {
  const maxNumber = opts.maxNumber ?? 400;
  const slug = streetSlug(street, suburb);
  const streetLc = street.toLowerCase().replace(/\bst\b|\bstreet\b|\bave\b|\bavenue\b/g, "").trim();

  // 1) Enumerate candidate addresses (both sides of the street).
  const numbers: number[] = [];
  for (let n = 1; n <= maxNumber; n++) numbers.push(n);

  // 2) Geocode each, keep those that land on the target street with a pano.
  const seen: { lat: number; lng: number }[] = [];
  let kept = 0;
  let processed = 0;

  const houses = await mapWithConcurrency(
    numbers,
    8,
    async (n): Promise<IndexedHouse | null> => {
      const geo = await geocodeAddress(`${n} ${street}, ${suburb}, Pretoria, South Africa`);
      processed++;
      opts.onProgress?.(processed, numbers.length, kept);
      if (!geo) return null;

      // must actually be on this street
      if (!geo.formattedAddress.toLowerCase().includes(streetLc)) return null;
      // must look like a real numbered address, not a street centroid
      if (!new RegExp(`\\b${n}\\b`).test(geo.formattedAddress)) return null;

      // dedupe: skip if within 12m of an already-kept point (geocoder
      // interpolation can map several numbers to the same spot)
      if (seen.some((s) => haversineMeters(s.lat, s.lng, geo.lat, geo.lng) < 12)) return null;
      seen.push({ lat: geo.lat, lng: geo.lng });

      const sv = await fetchStreetViewAimedAt(geo.lat, geo.lng);
      if (!sv) return null;

      const reply = await visionJson<FacadeReply>({
        model: MODELS.fingerprint,
        images: [base64Image(sv.base64, sv.mediaType)],
        prompt: `This is a Google Street View photo aimed at a residential property in ${suburb}, Pretoria.

Describe the street-facing facade for later matching against a property listing. Focus on PERMANENT features: wall material and colour, roof type/colour and shape, number of storeys, boundary wall/fence type and colour, gate style and colour, garage doors (count/colour), window pattern, driveway paving, and any distinctive permanent objects (wall-mounted cross, decorative gable, carport, etc.). Ignore cars, bins, people, weather.

If the photo does not actually show a house (empty stand, park, only road/wall with no building), set isHouse=false.

Respond ONLY with JSON:
{"isHouse": true/false, "facade": "one paragraph", "features": ["distinctive permanent feature", ...]}`,
        maxTokens: 500,
      });

      if (!reply.isHouse) return null;
      kept++;
      opts.onProgress?.(processed, numbers.length, kept);

      return {
        address: geo.formattedAddress,
        houseNumber: String(n),
        lat: geo.lat,
        lng: geo.lng,
        svKey: sv.key,
        svDate: sv.panoDate,
        facade: reply.facade,
        features: reply.features ?? [],
      };
    }
  );

  const indexed = houses.filter((h): h is IndexedHouse => h !== null);
  const index: StreetIndex = {
    street,
    suburb,
    slug,
    builtAt: new Date().toISOString(),
    houseCount: indexed.length,
    houses: indexed,
  };

  fs.mkdirSync(INDEX_DIR, { recursive: true });
  fs.writeFileSync(path.join(INDEX_DIR, `${slug}.json`), JSON.stringify(index, null, 2));
  return index;
}

// --- Matching uploaded/listing photos against an index ---

export interface StreetMatch {
  house: IndexedHouse;
  score: number;
  reasoning: string;
  matchingFeatures: string[];
  differences: string[];
}

interface MatchReply {
  score: number;
  reasoning: string;
  matchingFeatures: string[];
  differences: string[];
}

/**
 * Compare a listing's facade photos against every house in one or more street
 * indexes; return matches ranked by score.
 */
export async function matchListingToIndexes(
  listing: ListingData,
  fingerprint: PropertyFingerprint,
  indexes: StreetIndex[],
  onProgress?: (done: number, total: number) => void
): Promise<StreetMatch[]> {
  // Facade photos chosen during fingerprinting (1-indexed), else first few.
  const idx = (fingerprint.facade?.bestPhotoIndexes ?? [])
    .filter((i) => i >= 1 && i <= listing.photoUrls.length)
    .slice(0, 3);
  const facadeRefs = (idx.length ? idx.map((i) => listing.photoUrls[i - 1]) : listing.photoUrls.slice(0, 3));
  const facadeImages: ImageInput[] = facadeRefs.map(listingImage);

  const houses = indexes.flatMap((ix) => ix.houses);

  const results = await mapWithConcurrency(
    houses,
    6,
    async (house): Promise<StreetMatch | null> => {
      const svFile = path.join(process.cwd(), ".cache", "maps", `${house.svKey}.jpg`);
      if (!fs.existsSync(svFile)) return null;
      const svB64 = fs.readFileSync(svFile).toString("base64");

      const reply = await visionJson<MatchReply>({
        model: MODELS.compare,
        images: [...facadeImages, base64Image(svB64, "image/jpeg")],
        labels: [
          ...facadeRefs.map((_, i) => `Listing photo ${i + 1}:`),
          `Street View of ${house.address}${house.svDate ? ` (${house.svDate})` : ""}:`,
        ],
        prompt: `The first images are listing photos of a house's street facade. The LAST image is Google Street View of a specific address.

Is the Street View the SAME house as the listing photos? Weigh PERMANENT structure heavily (roof shape/material, garage count/position, gate and boundary-wall design, window pattern, wall material, storeys, distinctive objects). Weigh lightly: paint, garden, cars, weather, image age.

Score 0-100: 0-20 clearly different; 21-45 unlikely; 46-65 possible; 66-85 likely same; 86-100 definitely same.

Respond ONLY with JSON:
{"score": number, "reasoning": "1-2 sentences", "matchingFeatures": ["..."], "differences": ["..."]}`,
        maxTokens: 500,
      });

      return {
        house,
        score: Math.max(0, Math.min(100, reply.score ?? 0)),
        reasoning: reply.reasoning ?? "",
        matchingFeatures: reply.matchingFeatures ?? [],
        differences: reply.differences ?? [],
      };
    },
    onProgress
  );

  return results
    .filter((r): r is StreetMatch => r !== null)
    .sort((a, b) => b.score - a.score);
}
