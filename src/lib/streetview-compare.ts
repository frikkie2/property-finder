import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { FacadeSignature, PropertyFingerprint } from "./types";
import { fetchStreetViewAimedAt } from "./google-maps";
import { MODELS, base64Image, mapWithConcurrency, listingImage, visionJson, type ImageInput } from "./claude";
import type { ConfirmedCandidate } from "./tile-sweep";

const CACHE_DIR = path.join(process.cwd(), ".cache", "sv-compare");

export interface StreetViewScored extends ConfirmedCandidate {
  streetScore: number; // 0-100, or -1 when no Street View coverage
  streetReasoning: string;
  matchingFeatures: string[];
  differences: string[];
  streetViewKey: string | null;
  streetViewHeading: number | null;
  streetViewDate: string | null;
}

interface CompareReply {
  score: number;
  reasoning: string;
  matchingFeatures: string[];
  differences: string[];
}

function buildComparePrompt(
  fingerprint: PropertyFingerprint,
  facade: FacadeSignature | null,
  photoCount: number,
  houseNumber: string | null
): string {
  return `The first ${photoCount} image(s) are listing photos of a house's street facade. The LAST image is a Google Street View photo taken from the road, aimed at a candidate property.

Determine whether the Street View shows the SAME house as the listing photos.

Known facade signature:
"""${facade?.summary || "(none)"}"""
${houseNumber ? `The listing photos showed house number "${houseNumber}" — look for it in the Street View.` : ""}

Weigh PERMANENT structure heavily: roof shape/material, window and door positions, garage count and placement, wall material, boundary wall/fence/gate design, storeys, driveway position. Weigh lightly: paint colour, garden, trees (Street View can be years older), vehicles, image quality.

Score:
- 0-20: clearly a different house (structural contradiction)
- 21-45: unlikely — multiple structural mismatches
- 46-65: possible — partial view or some matches with unexplained differences
- 66-85: likely the same house — structure matches, minor cosmetic differences
- 86-100: definitely the same house — distinctive features align

If the Street View shows mostly a boundary wall/gate with the house barely visible, score what IS visible (gate style, wall, roofline above the wall) and say so.

Respond with ONLY valid JSON:
{"score": number, "reasoning": "1-2 sentences", "matchingFeatures": ["string"], "differences": ["string"]}`;
}

/**
 * Compare each candidate's aimed Street View image against the listing's
 * facade photos (passed by URL — Anthropic fetches them server-side).
 */
export async function scoreCandidatesViaStreetView(
  candidates: ConfirmedCandidate[],
  fingerprint: PropertyFingerprint,
  listingPhotoUrls: string[],
  onProgress?: (done: number, total: number) => void
): Promise<StreetViewScored[]> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Pick the facade photos chosen during fingerprinting (1-indexed), max 3
  const indexes = (fingerprint.facade?.bestPhotoIndexes ?? [])
    .filter((i) => i >= 1 && i <= listingPhotoUrls.length)
    .slice(0, 3);
  const facadePhotoUrls = indexes.length
    ? indexes.map((i) => listingPhotoUrls[i - 1])
    : listingPhotoUrls.slice(0, 2);

  const photoSetHash = crypto.createHash("md5").update(facadePhotoUrls.join("|")).digest("hex");

  const results = await mapWithConcurrency(
    candidates,
    6,
    async (candidate) => {
      const sv = await fetchStreetViewAimedAt(candidate.lat, candidate.lng);
      if (!sv) {
        return {
          ...candidate,
          streetScore: -1,
          streetReasoning: "No Street View coverage at this location",
          matchingFeatures: [],
          differences: [],
          streetViewKey: null,
          streetViewHeading: null,
          streetViewDate: null,
        } as StreetViewScored;
      }

      const cachePath = path.join(CACHE_DIR, `${crypto.createHash("md5").update(`${photoSetHash}-${sv.key}`).digest("hex")}.json`);
      if (fs.existsSync(cachePath)) {
        try {
          const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as CompareReply;
          return assemble(candidate, sv, cached);
        } catch { /* re-run */ }
      }

      const images: ImageInput[] = [
        ...facadePhotoUrls.map(listingImage),
        base64Image(sv.base64, sv.mediaType),
      ];
      const labels = [
        ...facadePhotoUrls.map((_, i) => `Listing photo ${i + 1}:`),
        `Street View (camera ${Math.round(sv.panoDistanceMeters)} m from target${sv.panoDate ? `, imagery ${sv.panoDate}` : ""}):`,
      ];

      const reply = await visionJson<CompareReply>({
        model: MODELS.compare,
        images,
        labels,
        prompt: buildComparePrompt(fingerprint, fingerprint.facade, facadePhotoUrls.length, fingerprint.houseNumber),
        maxTokens: 600,
      });

      fs.writeFileSync(cachePath, JSON.stringify(reply));
      return assemble(candidate, sv, reply);
    },
    onProgress
  );

  return results
    .filter((r): r is StreetViewScored => r !== null)
    .sort((a, b) => combinedScore(b) - combinedScore(a));
}

function assemble(
  candidate: ConfirmedCandidate,
  sv: { key: string; heading: number; panoDate: string | null },
  reply: CompareReply
): StreetViewScored {
  return {
    ...candidate,
    streetScore: Math.max(0, Math.min(100, reply.score ?? 0)),
    streetReasoning: reply.reasoning ?? "",
    matchingFeatures: reply.matchingFeatures ?? [],
    differences: reply.differences ?? [],
    streetViewKey: sv.key,
    streetViewHeading: sv.heading,
    streetViewDate: sv.panoDate,
  };
}

/**
 * Combined ranking score. Street View is the stronger signal when available;
 * candidates without coverage fall back to their aerial score (slightly
 * penalized so verified candidates rank above unverifiable ones).
 */
export function combinedScore(c: StreetViewScored): number {
  if (c.streetScore < 0) return c.aerialScore * 0.6;
  return 0.55 * c.streetScore + 0.45 * c.aerialScore;
}
