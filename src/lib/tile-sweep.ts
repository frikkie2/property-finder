import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { AerialSignature, ConfidenceLevel, SuburbBounds, SweepCandidate } from "./types";
import { fetchSatelliteImage } from "./google-maps";
import { MODELS, base64Image, mapWithConcurrency, visionJson } from "./claude";

/**
 * Footprint-free candidate enumeration.
 *
 * OpenStreetMap only has ~10% of the houses in these suburbs mapped, so any
 * approach that enumerates "buildings from a database" silently misses the
 * answer most of the time. Instead we sweep the suburb with satellite tiles
 * and let vision flag stands matching the listing's aerial signature —
 * coverage is complete by construction.
 */

// Zoom 18 tile footprint with scale=2 → zoom-19 pixel detail (0.27 m/px).
const SWEEP_ZOOM = 18;
const TILE_PX = 640;       // logical tile size requested from Static Maps
const IMAGE_PX = 1280;     // actual pixels with scale=2 — what the model sees
const OVERLAP = 0.12;      // fraction of tile overlap so edge stands aren't cut
const DEDUPE_METERS = 28;  // candidates closer than this are the same stand

const CACHE_DIR = path.join(process.cwd(), ".cache", "sweep");

// --- Web Mercator helpers (world coordinates at zoom 0 = 256px) ---

export function lngToWorldX(lng: number): number {
  return ((lng + 180) / 360) * 256;
}

export function latToWorldY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256;
}

export function worldXToLng(x: number): number {
  return (x / 256) * 360 - 180;
}

export function worldYToLat(y: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 256;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Metres per displayed pixel at this latitude for the sweep configuration. */
export function metersPerImagePixel(lat: number): number {
  // scale=2 doubles pixel density: effective zoom = SWEEP_ZOOM + 1
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, SWEEP_ZOOM + 1);
}

/**
 * Convert a pixel position inside a tile image (IMAGE_PX × IMAGE_PX, origin
 * top-left) to lat/lng, given the tile's centre.
 */
export function tilePixelToLatLng(
  centerLat: number,
  centerLng: number,
  px: number,
  py: number
): { lat: number; lng: number } {
  const zoomScale = Math.pow(2, SWEEP_ZOOM + 1); // scale=2 → one image px = one zoom-19 px
  const worldX = lngToWorldX(centerLng) * zoomScale + (px - IMAGE_PX / 2);
  const worldY = latToWorldY(centerLat) * zoomScale + (py - IMAGE_PX / 2);
  return {
    lat: worldYToLat(worldY / zoomScale),
    lng: worldXToLng(worldX / zoomScale),
  };
}

export interface SweepTile {
  centerLat: number;
  centerLng: number;
  index: number;
}

/** Generate the grid of tile centres covering a suburb's bounding box. */
export function generateSweepTiles(bounds: SuburbBounds): SweepTile[] {
  const midLat = (bounds.north + bounds.south) / 2;
  // Ground size of one tile (the *requested* TILE_PX at SWEEP_ZOOM)
  const metersPerLogicalPx = (156543.03392 * Math.cos((midLat * Math.PI) / 180)) / Math.pow(2, SWEEP_ZOOM);
  const tileMeters = metersPerLogicalPx * TILE_PX;
  const stepMeters = tileMeters * (1 - OVERLAP);

  const latStep = stepMeters / 111_320;
  const lngStep = stepMeters / (111_320 * Math.cos((midLat * Math.PI) / 180));

  const tiles: SweepTile[] = [];
  let index = 0;
  for (let lat = bounds.south + latStep / 2; lat < bounds.north + latStep / 2; lat += latStep) {
    for (let lng = bounds.west + lngStep / 2; lng < bounds.east + lngStep / 2; lng += lngStep) {
      tiles.push({ centerLat: Math.min(lat, bounds.north), centerLng: Math.min(lng, bounds.east), index: index++ });
    }
  }
  return tiles;
}

interface TileSweepReply {
  candidates: {
    px: number;
    py: number;
    confidence: ConfidenceLevel;
    matchedFeatures: string[];
  }[];
}

function buildSweepPrompt(aerial: AerialSignature, lat: number): string {
  const mpp = metersPerImagePixel(lat);
  const scaleHint = (m: number) => Math.round(m / mpp);

  const features: string[] = [];
  if (aerial.poolPresent) {
    features.push(
      `- SWIMMING POOL (${aerial.poolShape !== "unknown" ? aerial.poolShape : "any shape"}${aerial.poolPosition ? `, ${aerial.poolPosition}` : ""}) — a typical 8×4 m pool is about ${scaleHint(8)}×${scaleHint(4)} pixels here. Pools read as blue/turquoise rectangles or blobs.`
    );
  }
  if (aerial.standSizeM2) {
    const side = Math.sqrt(aerial.standSizeM2);
    features.push(
      `- LARGE STAND of ~${aerial.standSizeM2} m² — roughly ${scaleHint(side)}×${scaleHint(side)} pixels. Skip stands that are clearly much smaller or larger.`
    );
  }
  if (aerial.roofColour || aerial.roofShape) {
    features.push(`- ROOF: ${aerial.roofShape || "unknown shape"}${aerial.roofColour ? `, ${aerial.roofColour}` : ""}.`);
  }
  if (aerial.outbuildings?.length) features.push(`- OUTBUILDINGS: ${aerial.outbuildings.join(", ")}.`);
  if (aerial.drivewayDescription) features.push(`- DRIVEWAY: ${aerial.drivewayDescription}.`);
  if (aerial.treeCover) features.push(`- TREES: ${aerial.treeCover}.`);
  if (aerial.distinctiveAerial?.length) features.push(`- DISTINCTIVE: ${aerial.distinctiveAerial.join("; ")}.`);

  return `This is a satellite image tile of a Pretoria suburb, ${IMAGE_PX}×${IMAGE_PX} pixels, about ${(mpp).toFixed(2)} m per pixel. North is up.

We are looking for ONE SPECIFIC residential stand with this aerial signature:
${aerial.summary}

Key features to scan for:
${features.join("\n")}

Scan the whole tile carefully. Flag EVERY stand that could plausibly be this property — recall matters more than precision here (a later step verifies each flag with close-up imagery and Street View). But do not flag stands that clearly contradict a hard feature (e.g. no pool anywhere on the stand when the listing has a pool, or a tiny stand when we need a very large one). Satellite imagery may predate the listing by a few years.

For each flagged stand give the pixel coordinates of the MAIN HOUSE ROOF CENTRE (x from left, y from top, 0-${IMAGE_PX}).

Respond with ONLY valid JSON:
{"candidates": [{"px": number, "py": number, "confidence": "high|medium|low", "matchedFeatures": ["string"]}]}

If nothing plausibly matches, return {"candidates": []}.`;
}

function sweepCacheKey(tile: SweepTile, aerialHash: string): string {
  return crypto
    .createHash("md5")
    .update(`v2-${tile.centerLat.toFixed(6)},${tile.centerLng.toFixed(6)}-${aerialHash}`)
    .digest("hex");
}

export function hashAerial(aerial: AerialSignature): string {
  return crypto.createHash("md5").update(JSON.stringify(aerial)).digest("hex");
}

/**
 * Sweep a suburb for stands matching the aerial signature.
 * Returns deduplicated candidates sorted by confidence.
 */
export async function sweepSuburb(
  bounds: SuburbBounds,
  aerial: AerialSignature,
  onProgress?: (done: number, total: number, found: number) => void
): Promise<{ candidates: SweepCandidate[]; tilesScanned: number }> {
  const tiles = generateSweepTiles(bounds);
  const aerialHash = hashAerial(aerial);
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  let found = 0;
  const perTile = await mapWithConcurrency(
    tiles,
    8,
    async (tile) => {
      const cachePath = path.join(CACHE_DIR, `${sweepCacheKey(tile, aerialHash)}.json`);
      if (fs.existsSync(cachePath)) {
        try {
          return JSON.parse(fs.readFileSync(cachePath, "utf-8")) as SweepCandidate[];
        } catch { /* re-run */ }
      }

      const image = await fetchSatelliteImage(tile.centerLat, tile.centerLng, SWEEP_ZOOM, `${TILE_PX}x${TILE_PX}`, 2);
      const reply = await visionJson<TileSweepReply>({
        model: MODELS.sweep,
        images: [base64Image(image.base64, image.mediaType)],
        prompt: buildSweepPrompt(aerial, tile.centerLat),
        maxTokens: 1500,
      });

      const candidates: SweepCandidate[] = (reply.candidates || [])
        .filter((c) => typeof c.px === "number" && typeof c.py === "number")
        .map((c) => {
          const pos = tilePixelToLatLng(tile.centerLat, tile.centerLng, c.px, c.py);
          return {
            lat: pos.lat,
            lng: pos.lng,
            confidence: c.confidence ?? "low",
            matchedFeatures: c.matchedFeatures ?? [],
            tileKey: image.key,
          };
        });

      fs.writeFileSync(cachePath, JSON.stringify(candidates));
      return candidates;
    },
    (done, total) => {
      onProgress?.(done, total, found);
    }
  );

  const all = perTile.flatMap((c) => c ?? []);
  found = all.length;
  const deduped = dedupeCandidates(all);
  console.log(`[SWEEP] ${tiles.length} tiles, ${all.length} raw flags, ${deduped.length} unique candidates`);
  return { candidates: deduped, tilesScanned: tiles.length };
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 };

export function dedupeCandidates(candidates: SweepCandidate[]): SweepCandidate[] {
  const sorted = [...candidates].sort(
    (a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
  );
  const kept: SweepCandidate[] = [];
  for (const c of sorted) {
    const dupe = kept.some((k) => {
      const dLat = (k.lat - c.lat) * 111_320;
      const dLng = (k.lng - c.lng) * 111_320 * Math.cos((c.lat * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng) < DEDUPE_METERS;
    });
    if (!dupe) kept.push(c);
  }
  return kept;
}

// --- Stage 2: close-up confirmation of sweep candidates ---

export interface ConfirmedCandidate extends SweepCandidate {
  aerialScore: number; // 0-100
  aerialReasoning: string;
  closeupKey: string;
}

interface ConfirmReply {
  score: number;
  reasoning: string;
}

/**
 * Re-examine each sweep candidate with a zoom-20 close-up and score how well
 * the stand matches the aerial signature. Much more discriminating than the
 * wide sweep tiles.
 */
export async function confirmCandidates(
  candidates: SweepCandidate[],
  aerial: AerialSignature,
  onProgress?: (done: number, total: number) => void
): Promise<ConfirmedCandidate[]> {
  const results = await mapWithConcurrency(
    candidates,
    8,
    async (candidate) => {
      const image = await fetchSatelliteImage(candidate.lat, candidate.lng, 20, "640x640", 2);
      const reply = await visionJson<ConfirmReply>({
        model: MODELS.compare,
        images: [base64Image(image.base64, image.mediaType)],
        prompt: `This is a close-up satellite image centred on one residential stand (about 0.07 m per pixel, north up, the stand of interest is at the image centre).

Score 0-100 how well the CENTRE stand matches this aerial signature:
"""${aerial.summary}"""
${aerial.distinctiveAerial?.length ? `Distinctive features: ${aerial.distinctiveAerial.join("; ")}` : ""}
${aerial.standSizeM2 ? `Expected stand size: ~${aerial.standSizeM2} m²` : ""}

Scoring guide: 0-30 contradicts hard features (pool missing, wildly wrong stand size); 31-60 partially consistent; 61-85 most features present; 86-100 distinctive features clearly visible. Imagery may be a few years older than the listing.

Respond with ONLY valid JSON: {"score": number, "reasoning": "1-2 sentences"}`,
        maxTokens: 400,
      });

      return {
        ...candidate,
        aerialScore: Math.max(0, Math.min(100, reply.score ?? 0)),
        aerialReasoning: reply.reasoning ?? "",
        closeupKey: image.key,
      } as ConfirmedCandidate;
    },
    onProgress
  );

  return results
    .filter((r): r is ConfirmedCandidate => r !== null)
    .sort((a, b) => b.aerialScore - a.aerialScore);
}
