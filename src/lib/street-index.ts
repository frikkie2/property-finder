import fs from "fs";
import path from "path";
import crypto from "crypto";
import { geocodeAddress, fetchStreetViewHeadings, fetchSatelliteImage, haversineMeters, reverseGeocodeStreet } from "./google-maps";
import { resolveSuburbBounds } from "./suburb-data";
import { MODELS, base64Image, listingImage, mapWithConcurrency, visionJson, textJson, type ImageInput } from "./claude";
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
  svKey: string;        // primary (head-on) Street View image — for display
  svKeys: { key: string; label: string }[]; // all headings: head-on, angled L/R, opposite
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
  opts: { minNumber?: number; maxNumber?: number; onProgress?: (done: number, total: number, kept: number) => void } = {}
): Promise<StreetIndex> {
  const minNumber = Math.max(1, opts.minNumber ?? 1);
  const maxNumber = opts.maxNumber ?? 400;
  const slug = streetSlug(street, suburb);
  const streetLc = street.toLowerCase().replace(/\bst\b|\bstreet\b|\bave\b|\bavenue\b/g, "").trim();

  // 1) Enumerate candidate addresses (both sides of the street).
  const numbers: number[] = [];
  for (let n = minNumber; n <= maxNumber; n++) numbers.push(n);

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

      // Capture several headings: head-on, angled L/R (set-back houses), and the
      // opposite/across-street view (matches the background of outward-shot photos).
      const { shots, panoDate } = await fetchStreetViewHeadings(geo.lat, geo.lng);
      const headOn = shots[0] ? cachedMapImage(shots[0].key) : null;
      if (!headOn) return null;

      // Overhead close-up for aerial matching (pool, paving, roof, trees).
      let satKey: string | null = null;
      try {
        satKey = (await fetchSatelliteImage(geo.lat, geo.lng, 20, "640x640", 2)).key;
      } catch { /* satellite optional */ }

      const reply = await visionJson<FacadeReply>({
        model: MODELS.fingerprint,
        images: [headOn],
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
        svKey: shots[0].key,
        svKeys: shots.map((s) => ({ key: s.key, label: s.label })),
        satKey,
        svDate: panoDate,
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

// --- Suburb-wide indexing ---

export interface SuburbStreet {
  street: string;
  minNumber: number;
  maxNumber: number;
  hits: number;
}

/**
 * Discover the streets in a suburb (and the house-number range present on each)
 * via a coarse reverse-geocode grid over the suburb's bounding box.
 */
export async function discoverStreets(suburb: string, stepMeters = 60): Promise<SuburbStreet[]> {
  const b = await resolveSuburbBounds(suburb);
  const midLat = (b.north + b.south) / 2;
  const latStep = stepMeters / 111_320;
  const lngStep = stepMeters / (111_320 * Math.cos((midLat * Math.PI) / 180));

  const points: { lat: number; lng: number }[] = [];
  for (let lat = b.south; lat <= b.north; lat += latStep)
    for (let lng = b.west; lng <= b.east; lng += lngStep) points.push({ lat, lng });

  const suburbLc = suburb.toLowerCase();
  const streets = new Map<string, { min: number; max: number; hits: number }>();

  await mapWithConcurrency(points, 8, async (p) => {
    const r = await reverseGeocodeStreet(p.lat, p.lng);
    if (!r?.route) return;
    // keep only points whose sublocality matches the suburb (when present)
    if (r.suburb && r.suburb.toLowerCase() !== suburbLc) return;
    const cur = streets.get(r.route) ?? { min: Infinity, max: 0, hits: 0 };
    cur.hits++;
    if (r.streetNumber != null) {
      cur.min = Math.min(cur.min, r.streetNumber);
      cur.max = Math.max(cur.max, r.streetNumber);
    }
    streets.set(r.route, cur);
  });

  return [...streets.entries()]
    .map(([street, v]) => ({
      street,
      minNumber: Number.isFinite(v.min) ? v.min : 1,
      maxNumber: v.max || 300,
      hits: v.hits,
    }))
    // drop spurious one-off hits (likely bordering streets clipped by the bbox)
    .filter((s) => s.hits >= 1)
    .sort((a, b) => b.hits - a.hits);
}

/**
 * Index every street in a suburb. Each street is saved as its own
 * <street-suburb>.json, so the suburb becomes searchable via listStreetIndexes.
 */
export async function buildSuburbIndex(
  suburb: string,
  opts: {
    onProgress?: (info: { phase: string; streetsDone: number; streetsTotal: number; housesKept: number; currentStreet?: string }) => void;
  } = {}
): Promise<{ streets: number; houses: number }> {
  opts.onProgress?.({ phase: "discovering streets", streetsDone: 0, streetsTotal: 0, housesKept: 0 });
  const discovered = await discoverStreets(suburb);
  opts.onProgress?.({ phase: "indexing", streetsDone: 0, streetsTotal: discovered.length, housesKept: 0 });

  let housesKept = 0;
  let streetsDone = 0;
  for (const s of discovered) {
    try {
      const ix = await buildStreetIndex(s.street, suburb, {
        minNumber: Math.max(1, s.minNumber - 15),
        maxNumber: s.maxNumber + 15,
      });
      housesKept += ix.houseCount;
    } catch (err) {
      console.warn(`[SUBURB] ${s.street} failed: ${(err as Error).message}`);
    }
    streetsDone++;
    opts.onProgress?.({ phase: "indexing", streetsDone, streetsTotal: discovered.length, housesKept, currentStreet: s.street });
  }

  return { streets: streetsDone, houses: housesKept };
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
 * CHEAP pre-filter: rank all indexed houses against the listing using only the
 * stored TEXT signatures (facade description + features) vs the listing's
 * fingerprint, batched through a small model. Returns the most plausible
 * `keepTop` houses so the expensive image matcher only runs on a shortlist.
 * Recall-oriented (inclusive) — precision comes from the deep stage.
 */
export async function prefilterHouses(
  fingerprint: PropertyFingerprint,
  houses: IndexedHouse[],
  keepTop = 30
): Promise<IndexedHouse[]> {
  if (houses.length <= keepTop) return houses;

  const target = [
    `Facade (from the street): ${fingerprint.facade?.summary || "(unknown)"}`,
    `From above: ${fingerprint.aerial?.summary || "(unknown)"}`,
    `Distinctive cues: ${(fingerprint.exteriorCues || []).join("; ") || "(none)"}`,
    `Storeys: ${fingerprint.storeys ?? "?"}, pool: ${fingerprint.aerial?.poolPresent ? "yes" : "unknown"}`,
  ].join("\n");

  const BATCH = 50;
  const batches: IndexedHouse[][] = [];
  for (let i = 0; i < houses.length; i += BATCH) batches.push(houses.slice(i, i + BATCH));

  const perBatch = await mapWithConcurrency(batches, 6, async (batch, bi) => {
    const lines = batch
      .map((h, j) => `#${bi * BATCH + j}: ${(h.facade || "").slice(0, 220)} | features: ${(h.features || []).slice(0, 6).join(", ")}`)
      .join("\n");
    const reply = await textJson<{ keep: { id: number; score: number }[] }>(
      MODELS.prefilter,
      `You are shortlisting houses that could be the TARGET property. Judge on the text only.

TARGET:
${target}

CANDIDATE HOUSES:
${lines}

Return every candidate that could PLAUSIBLY be the target — be INCLUSIVE, this is a recall-oriented shortlist, not the final answer. Weight DISTINCTIVE matches (unusual wall colour like salmon-pink/ochre, a thatched lapa, double-storey, a specific pool shape, named features) and rule out only clear contradictions (e.g. single vs double storey).

Respond ONLY JSON: {"keep": [{"id": number, "score": 0-100}]}`,
      1200
    );
    return reply.keep ?? [];
  });

  const merged = perBatch
    .flat()
    .filter((x): x is { id: number; score: number } => x != null)
    .sort((a, b) => b.score - a.score);
  const picked = merged
    .slice(0, keepTop)
    .map((x) => houses[x.id])
    .filter((h): h is IndexedHouse => !!h);
  // Safety: if the model returned too few, pad with the next houses.
  if (picked.length < Math.min(keepTop, houses.length)) {
    const have = new Set(picked);
    for (const h of houses) {
      if (picked.length >= keepTop) break;
      if (!have.has(h)) picked.push(h);
    }
  }
  console.log(`[PREFILTER] ${houses.length} houses -> ${picked.length} shortlisted`);
  return picked;
}

/**
 * Compare a listing's photos against the indexed houses; return matches ranked
 * by score. Over a large index the cheap pre-filter trims to a shortlist first.
 */
export async function matchListingToIndexes(
  listing: ListingData,
  fingerprint: PropertyFingerprint,
  indexes: StreetIndex[],
  onProgress?: (done: number, total: number) => void,
  onPhase?: (phase: string) => void
): Promise<StreetMatch[]> {
  // Facade photos chosen during fingerprinting (1-indexed), else first few.
  const idx = (fingerprint.facade?.bestPhotoIndexes ?? [])
    .filter((i) => i >= 1 && i <= listing.photoUrls.length)
    .slice(0, 3);
  const facadeRefs = (idx.length ? idx.map((i) => listing.photoUrls[i - 1]) : listing.photoUrls.slice(0, 3));
  const facadeImages: ImageInput[] = facadeRefs.map(listingImage);

  const allHouses = indexes.flatMap((ix) => ix.houses);
  // Stage 1: cheap text shortlist when the index is large.
  if (allHouses.length > 40) onPhase?.(`Pre-filtering ${allHouses.length} houses (cheap pass)...`);
  const houses = await prefilterHouses(fingerprint, allHouses, 30);
  if (allHouses.length > 40) onPhase?.(`Deep-comparing the top ${houses.length} candidates...`);

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
      // All captured headings (head-on, angled L/R, opposite/across-street).
      const svShots = (house.svKeys?.length ? house.svKeys : [{ key: house.svKey, label: "head-on" }])
        .map((s) => ({ ...s, img: cachedMapImage(s.key) }))
        .filter((s) => s.img);
      if (svShots.length === 0) return null;

      // --- Signal 1: street-side comparison via exterior CUES ---
      // Listings are often interior-heavy with only glimpses of the outside, so
      // instead of demanding a full facade we check how many distinctive
      // exterior cues (lamp pole, boundary wall colour, a specific tree,
      // neighbour features…) are corroborated by ANY of the street views.
      const facadeP = visionJson<MatchReply>({
        model: MODELS.compare,
        images: [...facadeImages, ...svShots.map((s) => s.img!)],
        labels: [
          ...facadeRefs.map((_, i) => `Listing photo ${i + 1}:`),
          ...svShots.map((s) => `Street View (${s.label}) of ${house.address}${house.svDate ? ` ${house.svDate}` : ""}:`),
        ],
        prompt: `The first image(s) are listing photos of ONE property — they may show the full street facade, OR only interior rooms with small glimpses of the outside (through windows/doors, in backgrounds, at edges). Note: listing photos are often shot from INSIDE the stand looking OUT toward the street, so their backgrounds show the across-the-road streetscape. The remaining images are several Google Street View headings at this candidate address: head-on at the house, angled left/right (to catch a house set back behind a wall/trees), and the OPPOSITE direction (the across-street view that would appear behind an outward-facing listing photo).

The property's distinctive EXTERIOR CUES (mined from all its photos) are:
${(cues.length ? cues.map((c, i) => `  ${i + 1}. ${c}`).join("\n") : "  (none extracted)")}

Also use the facade signature if the listing shows the front: """${fingerprint.facade?.summary || ""}"""

Your job: judge how strongly THIS Street View corroborates the property. Go cue by cue — is each present / plausibly present / clearly absent or contradicted?

CRITICAL — weight by DISTINCTIVENESS, not by count:
- A match on a RARE cue is strong evidence the house is the same: an unusual wall COLOUR (salmon/terracotta-pink, ochre), arched wrought-iron gates, a thatched lapa with a chimney, a specific tree species by the gate, a named wall plaque. ONE clear rare-cue match should score 80+.
- A match on a COMMON cue is weak and near-worthless on its own: "has a wall", "has a black palisade sliding gate", "has a paved driveway", "has trees" — most houses on this street have these. Do NOT score high just because common cues match.
- A hard contradiction (storeys differ; cue says salmon-pink plaster, this is bare face-brick) is strong evidence AGAINST → score low.
- If mature trees obscure the frontage so cues can't be checked, say so and score modestly (40-55), not high.

Street View may predate the listing (paint/plants change; structure, walls, poles, mature trees do not).
Score 0-100: 0-20 contradicted; 21-45 only common cues / mostly hidden; 46-65 one rare cue partially matches or several common ones; 66-85 a rare distinctive cue clearly matches; 86-100 multiple distinctive cues clearly match. Use the FULL range.
Respond ONLY JSON: {"score": number, "reasoning": "which cues matched/contradicted and how rare", "matchingFeatures": ["cues corroborated"], "differences": ["cues contradicted"]}`,
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

Judge whether the listing property could be THIS stand seen from above, weighting by DISTINCTIVENESS:
- DISTINCTIVE overhead features (strong evidence when they match): a thatched lapa (round/irregular textured roof, often with a chimney), an unusual pool SHAPE and its exact position relative to the house, a flat-roofed carport in a specific spot, an L/T/U roof footprint, a tennis court, a large solar array.
- GENERIC features (near-worthless on their own — most stands have them): "has a pool", "has a paved driveway", "has trees", "has a rectangular roof". Do NOT score high on these alone.
${aerialSummary ? `Expected overhead signature from the listing: "${aerialSummary}"` : ""}

Reward a clear match on a distinctive feature (e.g. a thatched lapa in the right position, the same pool shape) with 80+. Score modestly (40-60) when only generic features align. Penalize hard contradictions (listing has a pool, this stand clearly has none) with <25.
If the listing photos give no overhead-relevant cues at all, return score -1 (not 70).
Score: -1 no aerial cues; 0-20 contradicts; 21-45 only generic alignment / unlikely; 46-65 generic match; 66-85 a distinctive feature matches; 86-100 multiple distinctive features match. Use the FULL range — do NOT default to ~72.
Respond ONLY JSON: {"score": number, "reasoning": "name the distinctive vs generic features"}`,
            maxTokens: 400,
          }).catch(() => null)
        : Promise.resolve(null);

      const [facadeR, aerialR] = await Promise.all([facadeP, aerialP]);

      const facadeScore = typeof facadeR?.score === "number" ? facadeR.score : -1;
      const aerialScore = typeof aerialR?.score === "number" ? aerialR.score : -1;

      // Combine by the STRONGEST signal, not a dilutive average: a strong
      // distinctive match in either channel (a salmon-pink wall from the
      // street, or a thatched lapa from above) should carry the score even if
      // the other channel is generic/blocked. max-leaning: 0.65*max + 0.35*min.
      const valid = [facadeScore, aerialScore].filter((s) => s >= 0);
      const combined = valid.length
        ? Math.round(0.65 * Math.max(...valid) + 0.35 * Math.min(...valid))
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
    // Head-on plus the opposite (across-street) heading, which matches the
    // background of outward-facing listing photos.
    const shots = m.house.svKeys?.length ? m.house.svKeys : [{ key: m.house.svKey, label: "head-on" }];
    const chosen = shots.filter((s) => /head-on|opposite/.test(s.label));
    for (const s of (chosen.length ? chosen : shots.slice(0, 1))) {
      const img = cachedMapImage(s.key);
      if (img) {
        labels.push(`Candidate ${LETTERS[i]} (${m.house.address}) — Street View ${s.label}:`);
        images.push(img);
      }
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
