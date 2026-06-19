import fs from "fs";
import path from "path";
import crypto from "crypto";
import { geocodeAddress, fetchStreetViewAimedAt, fetchSatelliteImage, haversineMeters } from "./google-maps";
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
  satKey: string | null; // cached satellite close-up (overhead) for aerial matching
  svDate: string | null;
  facade: string;       // one-paragraph description of the street-facing facade
  features: string[];   // distinctive permanent features
  // Two independent number signals, shown side by side — the pin (lat/lng) is
  // the ground truth, the numbers are corroboration:
  googleNumber: string;        // Google's geocoded number (often interpolated, ±1-2 plots)
  readNumber: string | null;   // number actually read off the gate/wall in Street View, if legible
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
const MAPS_DIR = path.join(process.cwd(), ".cache", "maps");

/**
 * Load a cached Street View / satellite image with the CORRECT media type.
 * Google satellite tiles are PNG, Street View is JPEG — both are stored with a
 * .jpg extension, so detect from the magic bytes (Anthropic 400s on a mismatch).
 */
function cachedMapImage(key: string | null | undefined): ImageInput | null {
  if (!key) return null;
  const file = path.join(MAPS_DIR, `${key}.jpg`);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const mt: "image/png" | "image/jpeg" | "image/webp" =
    buf[0] === 0x89 && buf[1] === 0x50 ? "image/png"
    : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg"
    : buf[0] === 0x52 && buf[1] === 0x49 ? "image/webp"
    : "image/png";
  return base64Image(buf.toString("base64"), mt);
}

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
  houseNumber: string | null;
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

      // Overhead close-up for aerial matching (pool, paving, roof, trees).
      let satKey: string | null = null;
      try {
        satKey = (await fetchSatelliteImage(geo.lat, geo.lng, 20, "640x640", 2)).key;
      } catch { /* satellite optional */ }

      const reply = await visionJson<FacadeReply>({
        model: MODELS.fingerprint,
        images: [base64Image(sv.base64, sv.mediaType)],
        prompt: `This is a Google Street View photo aimed at a residential property in ${suburb}, Pretoria.

Describe the street-facing facade for later matching against a property listing. Focus on PERMANENT features: wall material and colour, roof type/colour and shape, number of storeys, boundary wall/fence type and colour, gate style and colour, garage doors (count/colour), window pattern, driveway paving, and any distinctive permanent objects (wall-mounted cross, decorative gable, carport, etc.). Ignore cars, people and weather.

If the photo does not actually show a house (empty stand, park, only road/wall with no building), set isHouse=false.

Also READ THE HOUSE NUMBER if it is clearly legible anywhere in the image. In South Africa the street number is very commonly painted on the kerbside wheelie/refuse BIN, and also appears on the gate, wall, gate pillar, kerb, or postbox — check the bin first. Only report digits you can actually read; if none is legible, use null. Do NOT guess or use a neighbouring house's number.

Respond ONLY with JSON:
{"isHouse": true/false, "houseNumber": null | "digits only, e.g. 117", "facade": "one paragraph", "features": ["distinctive permanent feature", ...]}`,
        maxTokens: 500,
      });

      if (!reply.isHouse) return null;
      kept++;
      opts.onProgress?.(processed, numbers.length, kept);

      // Keep BOTH number signals rather than picking one: Google's geocoded
      // number (often interpolated) and the number read off the gate (if any).
      const googleNumber = (geo.formattedAddress.match(/^\d+[A-Za-z]?/) || [String(n)])[0];
      const ocr = (reply.houseNumber ?? "").trim();
      const readNumber = /^\d{1,4}[A-Za-z]?$/.test(ocr) ? ocr : null;

      return {
        address: geo.formattedAddress,
        houseNumber: googleNumber,
        googleNumber,
        readNumber,
        lat: geo.lat,
        lng: geo.lng,
        svKey: sv.key,
        satKey,
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
  score: number;        // combined facade + aerial
  facadeScore: number;  // street-view facade match (-1 if not assessable)
  aerialScore: number;  // satellite/overhead match (-1 if no satellite)
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

interface AerialReply {
  score: number;
  reasoning: string;
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

  // For the aerial signal, send a broader set of listing photos (pool, garden,
  // paving, roofline are spread across the set, not just the facade picks).
  const aerialRefUrls = listing.photoUrls.slice(0, 5);
  const aerialRefImages: ImageInput[] = aerialRefUrls.map(listingImage);
  const aerialSummary = fingerprint.aerial?.summary ?? "";
  const cues = fingerprint.exteriorCues ?? [];

  const results = await mapWithConcurrency(
    houses,
    6,
    async (house): Promise<StreetMatch | null> => {
      const svImg = cachedMapImage(house.svKey);
      if (!svImg) return null;

      // --- Signal 1: street-side comparison via exterior CUES ---
      // Listings are often interior-heavy with only glimpses of the outside, so
      // instead of demanding a full facade we check how many distinctive
      // exterior cues (lamp pole, boundary wall colour, a specific tree,
      // neighbour features…) are corroborated by this Street View.
      const facadeP = visionJson<MatchReply>({
        model: MODELS.compare,
        images: [...facadeImages, svImg],
        labels: [
          ...facadeRefs.map((_, i) => `Listing photo ${i + 1}:`),
          `Street View of ${house.address}${house.svDate ? ` (${house.svDate})` : ""}:`,
        ],
        prompt: `The first image(s) are listing photos of ONE property — they may show the full street facade, OR only interior rooms with small glimpses of the outside (through windows/doors, in backgrounds, at edges). The LAST image is Google Street View of a candidate address.

The property's distinctive EXTERIOR CUES (mined from all its photos) are:
${(cues.length ? cues.map((c, i) => `  ${i + 1}. ${c}`).join("\n") : "  (none extracted)")}

Also use the facade signature if the listing shows the front: """${fingerprint.facade?.summary || ""}"""

Your job: judge how strongly THIS Street View corroborates the property. Go cue by cue — is each one present / plausibly present / clearly absent or contradicted? A municipal lamp pole, a specific boundary-wall colour+material, a distinctive tree by the gate, or a neighbour's feature appearing here is strong support; a hard contradiction (e.g. cue says low face-brick wall, this is a tall white plaster wall; or storeys differ) is strong evidence against.

Street View may predate the listing (paint/plants change; structure, walls, poles, mature trees do not).
Score 0-100 by weight of corroboration: 0-20 contradicted; 21-45 little/no support; 46-65 some cues match; 66-85 several distinctive cues match; 86-100 multiple distinctive cues clearly match. Use the FULL range — do not default to a middle value.
Respond ONLY JSON: {"score": number, "reasoning": "which cues matched/contradicted", "matchingFeatures": ["cues corroborated"], "differences": ["cues contradicted"]}`,
        maxTokens: 700,
      }).catch(() => null);

      // --- Signal 2: satellite / overhead comparison ---
      const satImg = cachedMapImage(house.satKey);
      const aerialP: Promise<AerialReply | null> = satImg
        ? visionJson<AerialReply>({
            model: MODELS.compare,
            images: [...aerialRefImages, satImg],
            labels: [
              ...aerialRefUrls.map((_, i) => `Listing photo ${i + 1}:`),
              `Satellite (overhead) of ${house.address}:`,
            ],
            prompt: `The first image(s) are listing photos of a property (may show pool, garden, patio, driveway, carport, roof — not necessarily the street). The LAST image is a Google satellite (overhead) view of a candidate stand.

Judge whether the listing property could be THIS stand seen from above. Reason about overhead-visible features:
- SWIMMING POOL: present? shape and rough position on the stand?
- PAVING/DRIVEWAY: extent, pattern, courtyard paving.
- ROOF footprint: shape (L/T/rectangle), carport/flat sections, colour.
- TREES: large canopy trees and their position.
- STAND layout: house position, open garden areas, outbuildings/lapa.
${aerialSummary ? `Expected overhead signature from the listing: "${aerialSummary}"` : ""}

If the listing photos give no overhead-relevant cues at all, return score -1.
Score: -1 no aerial cues; 0-20 contradicts (e.g. listing has a pool, this stand has none); 21-45 unlikely; 46-65 possible; 66-85 likely; 86-100 strong overhead match.
Respond ONLY JSON: {"score": number, "reasoning": "..."}`,
            maxTokens: 400,
          }).catch(() => null)
        : Promise.resolve(null);

      const [facadeR, aerialR] = await Promise.all([facadeP, aerialP]);

      const facadeScore = typeof facadeR?.score === "number" ? facadeR.score : -1;
      const aerialScore = typeof aerialR?.score === "number" ? aerialR.score : -1;

      // Combine: drop unassessable signals, weight aerial a touch higher (it is
      // the discriminator when the listing has no street-facing photo).
      const parts: { w: number; v: number }[] = [];
      if (facadeScore >= 0) parts.push({ w: 0.5, v: facadeScore });
      if (aerialScore >= 0) parts.push({ w: 0.5, v: aerialScore });
      const combined = parts.length
        ? Math.round(parts.reduce((s, p) => s + p.w * p.v, 0) / parts.reduce((s, p) => s + p.w, 0))
        : 0;

      return {
        house,
        score: combined,
        facadeScore,
        aerialScore,
        reasoning: [facadeR?.reasoning && `Facade: ${facadeR.reasoning}`, aerialR?.reasoning && `Aerial: ${aerialR.reasoning}`].filter(Boolean).join(" | "),
        matchingFeatures: facadeR?.matchingFeatures ?? [],
        differences: facadeR?.differences ?? [],
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

  // Show MORE listing photos here (garden/pool/aerial cues matter), plus each
  // candidate's Street View AND satellite image.
  const listingRefs = [...new Set([...idx, 1, 2, 3, 4, 5])]
    .filter((i) => i >= 1 && i <= listing.photoUrls.length)
    .slice(0, 6);
  const images: ImageInput[] = [];
  const labels: string[] = [];
  listingRefs.forEach((i) => { labels.push(`Listing photo ${i}:`); images.push(listingImage(listing.photoUrls[i - 1])); });
  top.forEach((m, i) => {
    const svImg = cachedMapImage(m.house.svKey);
    if (svImg) {
      labels.push(`Candidate ${LETTERS[i]} (${m.house.address}) — Street View:`);
      images.push(svImg);
    }
    const satImg = cachedMapImage(m.house.satKey);
    if (satImg) {
      labels.push(`Candidate ${LETTERS[i]} — Satellite (overhead):`);
      images.push(satImg);
    }
  });

  const cues = fingerprint.exteriorCues ?? [];
  const prompt = `The first image(s) are listing photos of ONE property (they may show the street facade, OR only interior rooms with small glimpses of the outside, OR garden/pool/patio). For each candidate (A, B, C…) you get a Street View and a Satellite (overhead) image.

The property's distinctive EXTERIOR CUES (mined from all its photos):
${cues.length ? cues.map((c, i) => `  ${i + 1}. ${c}`).join("\n") : "  (none extracted)"}

Identify which candidate, if any, is the SAME property. Use ALL evidence:
- Exterior cues above — does the candidate's Street View show that lamp pole / boundary-wall colour / specific tree / neighbour feature?
- Street View: storeys (hard discriminator), roof, boundary wall/fence type+colour, gate, garage/carport, windows, driveway, distinctive objects.
- Satellite: swimming pool (presence/shape/position), paving/courtyard, roof footprint, large trees, stand layout.
Weight DISTINCTIVE matches (a specific pole, an unusual wall colour, a kidney pool in the right spot) far more than generic ones (has a wall, has a pool — most houses do). Street View/satellite may predate the listing (paint/plants change; structure, walls, poles, pools do not).

Rank ALL candidates best to worst with a calibrated confidence 0-100 each:
- 85+ certain same property; 65-84 strong; 40-64 plausible; <40 weak/contradicted.
If none is a real match, every confidence should be low and say so.

Respond ONLY with JSON:
{"ranking": [{"candidate": "A", "confidence": number, "verdict": "decisive evidence from facade and/or overhead"}]}`;

  // Best-of-3 voting: the single-pass ranking is noisy (it has flipped between
  // two lookalike neighbours run-to-run). Run the adjudication 3× and average
  // each candidate's confidence to get a stable ranking.
  const ROUNDS = 3;
  const runs = await mapWithConcurrency(
    Array.from({ length: ROUNDS }, (_, i) => i),
    ROUNDS,
    () =>
      visionJson<{ ranking: { candidate: string; confidence: number; verdict: string }[] }>({
        model: MODELS.adjudicate,
        images,
        labels,
        prompt,
        maxTokens: 1500,
      })
  );

  // Aggregate per candidate letter: average confidence across the rounds it
  // appeared in; keep the verdict from its highest-confidence round.
  const agg = new Map<string, { sum: number; n: number; bestConf: number; verdict: string }>();
  for (const run of runs) {
    if (!run) continue;
    for (const r of run.ranking ?? []) {
      const letter = (r.candidate || "").trim().toUpperCase();
      if (!byLetterExists(top, letter)) continue;
      const conf = Math.max(0, Math.min(100, r.confidence ?? 0));
      const cur = agg.get(letter) ?? { sum: 0, n: 0, bestConf: -1, verdict: "" };
      cur.sum += conf;
      cur.n += 1;
      if (conf > cur.bestConf) { cur.bestConf = conf; cur.verdict = r.verdict || ""; }
      agg.set(letter, cur);
    }
  }

  const scored = top.map((m, i) => {
    const a = agg.get(LETTERS[i]);
    const avg = a && a.n > 0 ? Math.round(a.sum / a.n) : m.score;
    return { ...m, score: avg, reasoning: a?.verdict || m.reasoning } as StreetMatch;
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.map((m, i) => ({ ...m, rank: i + 1 }));
}

function byLetterExists(top: StreetMatch[], letter: string): boolean {
  const idx = LETTERS.indexOf(letter);
  return idx >= 0 && idx < top.length;
}
