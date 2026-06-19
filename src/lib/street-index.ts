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
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    // Reject anything that isn't an actual index (e.g. a .status.json file).
    if (!data || !Array.isArray(data.houses) || typeof data.suburb !== "string") return null;
    return data as StreetIndex;
  } catch {
    return null;
  }
}

export function listStreetIndexes(): StreetIndex[] {
  if (!fs.existsSync(INDEX_DIR)) return [];
  return fs
    .readdirSync(INDEX_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".status.json"))
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
        prompt: `The first image(s) are listing photos of ONE house's street frontage. The LAST image is Google Street View of a candidate address. Decide if they are the SAME house.

Go feature by feature and compare every visible attribute:
- STOREYS: single vs double storey. This is a HARD discriminator — a single-storey house can never match a double-storey one.
- ROOF: type (tile/sheet/flat), colour, shape (hipped/gable), and any fascia/gutter colour.
- WALLS: material (face brick/plaster), colour.
- BOUNDARY: wall vs palisade vs combination; its colour; infill (solid/slatted/spear-top/horizontal bar); whether it has a brick base wall or sits low at ground level.
- GATE: style, colour, material, sliding vs swing.
- GARAGE/CARPORT: count, position, colour.
- WINDOWS: arrangement, burglar bars.
- DRIVEWAY/PAVEMENT: paving material and pattern.
- GARDEN: distinctive plants (palms, cycads), large trees and their position.
- DISTINCTIVE: postbox, wall cross, decorative discs, pergola/gazebo, balcony, dormer/clerestory, house number.

Street View may be a few years older than the listing: paint and plants can change, but STRUCTURE (storeys, roof shape, boundary type, garage position, window layout) does not. If storeys differ, score <=20 regardless of other similarities.

Score 0-100: 0-20 clearly different (incl. storey mismatch); 21-45 unlikely; 46-65 possible; 66-85 likely same; 86-100 definitely same.

Respond ONLY with JSON:
{"score": number, "reasoning": "what is decisive", "matchingFeatures": ["..."], "differences": ["..."]}`,
        maxTokens: 600,
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

const LETTERS = "ABCDEFGHIJ";

export interface AdjudicatedMatch extends StreetMatch {
  rank: number;
}

/**
 * Head-to-head adjudication: show the listing photos and the top candidates'
 * Street View images together and force a single calibrated ranking. This
 * breaks the ties a per-house score produces and lets the model pick the one
 * best fit rather than scoring each in isolation.
 */
export async function adjudicateStreetMatches(
  matches: StreetMatch[],
  listing: ListingData,
  fingerprint: PropertyFingerprint
): Promise<AdjudicatedMatch[]> {
  const top = matches.slice(0, 6);
  if (top.length <= 1) return top.map((m, i) => ({ ...m, rank: i + 1 }));

  const idx = (fingerprint.facade?.bestPhotoIndexes ?? [])
    .filter((i) => i >= 1 && i <= listing.photoUrls.length)
    .slice(0, 3);
  const facadeRefs = idx.length ? idx.map((i) => listing.photoUrls[i - 1]) : listing.photoUrls.slice(0, 3);

  const images: ImageInput[] = [];
  const labels: string[] = [];
  facadeRefs.forEach((u, i) => { labels.push(`Listing photo ${i + 1}:`); images.push(listingImage(u)); });
  top.forEach((m, i) => {
    const file = path.join(process.cwd(), ".cache", "maps", `${m.house.svKey}.jpg`);
    if (fs.existsSync(file)) {
      labels.push(`Candidate ${LETTERS[i]} — ${m.house.address}:`);
      images.push(base64Image(fs.readFileSync(file).toString("base64"), "image/jpeg"));
    }
  });

  const reply = await visionJson<{ ranking: { candidate: string; confidence: number; verdict: string }[] }>({
    model: MODELS.adjudicate,
    images,
    labels,
    prompt: `The first image(s) are listing photos of ONE house. The remaining images are Street View of candidate addresses (A, B, C…) on the same street.

Identify which candidate, if any, is the SAME house as the listing. Compare storeys (hard discriminator), roof shape/colour, boundary wall/fence type+colour, gate, garage position, window layout, driveway, distinctive features. Street View may predate the listing (paint/plants change; structure does not).

Rank ALL candidates best to worst with a calibrated confidence 0-100 each:
- 85+ certain same house; 65-84 strong; 40-64 plausible; <40 weak/contradicted (use <20 if storeys differ).
If none is a real match, every confidence should be low and say so.

Respond ONLY with JSON:
{"ranking": [{"candidate": "A", "confidence": number, "verdict": "decisive evidence"}]}`,
    maxTokens: 1500,
  });

  const byLetter = new Map(top.map((m, i) => [LETTERS[i], m]));
  const out: AdjudicatedMatch[] = [];
  let rank = 1;
  for (const r of reply.ranking ?? []) {
    const m = byLetter.get((r.candidate || "").trim().toUpperCase());
    if (!m) continue;
    out.push({ ...m, score: Math.max(0, Math.min(100, r.confidence ?? m.score)), reasoning: r.verdict || m.reasoning, rank: rank++ });
    byLetter.delete((r.candidate || "").trim().toUpperCase());
  }
  // Append any not mentioned, lowest.
  for (const [, m] of byLetter) out.push({ ...m, rank: rank++ });
  return out;
}
