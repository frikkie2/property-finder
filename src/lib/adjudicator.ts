import type { ListingData, PropertyFingerprint } from "./types";
import { fetchSatelliteImage, reverseGeocode, geocodeAddress, fetchStreetViewAimedAt } from "./google-maps";
import { MODELS, base64Image, listingImage, visionJson, type ImageInput } from "./claude";
import type { StreetViewScored } from "./streetview-compare";
import fs from "fs";
import path from "path";

export interface FinalCandidate {
  rank: number;
  address: string;
  lat: number;
  lng: number;
  confidence: number; // 0-100 calibrated
  verdict: string;
  matchingFeatures: string[];
  differences: string[];
  streetViewKey: string | null;
  satelliteKey: string | null;
}

interface AdjudicationReply {
  ranking: {
    candidate: string; // "A", "B", ...
    confidence: number;
    verdict: string;
  }[];
}

const LETTERS = "ABCDEFGHIJ";

/**
 * Final adjudication: one call to the strongest model with the listing
 * photos and, per candidate, the aimed Street View + satellite close-up.
 * Produces a calibrated ranking of the top 5.
 */
export async function adjudicate(
  candidates: StreetViewScored[],
  listing: ListingData,
  fingerprint: PropertyFingerprint
): Promise<FinalCandidate[]> {
  const top = candidates.slice(0, 8);
  if (top.length === 0) return [];

  // Listing photos: facade picks + a couple of others, all by URL
  const facadeIdx = (fingerprint.facade?.bestPhotoIndexes ?? []).filter(
    (i) => i >= 1 && i <= listing.photoUrls.length
  );
  const photoIdx = [...new Set([...facadeIdx, 1, 2])].slice(0, 4);
  const listingPhotos = photoIdx.map((i) => listing.photoUrls[i - 1]).filter(Boolean);

  const images: ImageInput[] = [];
  const labels: string[] = [];

  listingPhotos.forEach((url, i) => {
    labels.push(`Listing photo ${i + 1}:`);
    images.push(listingImage(url));
  });

  const candidateMeta: string[] = [];
  for (let i = 0; i < top.length; i++) {
    const c = top[i];
    const letter = LETTERS[i];

    const closeup = await fetchSatelliteImage(c.lat, c.lng, 20, "640x640", 2);
    labels.push(`Candidate ${letter} — satellite close-up:`);
    images.push(base64Image(closeup.base64, closeup.mediaType));

    if (c.streetViewKey) {
      const sv = await fetchStreetViewAimedAt(c.lat, c.lng);
      if (sv) {
        labels.push(`Candidate ${letter} — Street View${sv.panoDate ? ` (${sv.panoDate})` : ""}:`);
        images.push(base64Image(sv.base64, sv.mediaType));
      }
    }

    candidateMeta.push(
      `Candidate ${letter}: aerial match ${c.aerialScore}/100 ("${c.aerialReasoning}"), ` +
      (c.streetScore >= 0
        ? `street view match ${c.streetScore}/100 ("${c.streetReasoning}")`
        : `no Street View coverage`)
    );
  }

  const prompt = `You are identifying which candidate property is the house shown in the listing photos.

LISTING: ${listing.bedrooms ?? "?"} bed / ${listing.bathrooms ?? "?"} bath in ${listing.listedSuburb}${listing.plotSize ? `, erf ${listing.plotSize} m²` : ""}.
DESCRIPTION: """${listing.description.slice(0, 1200)}"""
FACADE SIGNATURE: """${fingerprint.facade?.summary || ""}"""
AERIAL SIGNATURE: """${fingerprint.aerial?.summary || ""}"""

Earlier screening results:
${candidateMeta.join("\n")}

Compare each candidate's satellite close-up and Street View against the listing photos. Trust permanent structure (roof geometry, pool shape and position, garage placement, window pattern, boundary walls) over cosmetics. Imagery dates differ — paint, gardens and pools' water colour change; structure does not.

Rank ALL candidates from most to least likely, with a calibrated confidence 0-100 for each:
- 90+: certain — distinctive features align across both views
- 70-89: strong match, minor unverifiable details
- 40-69: plausible but not confirmed
- <40: weak / contradicted

Respond with ONLY valid JSON:
{"ranking": [{"candidate": "A", "confidence": number, "verdict": "2-3 sentences: the decisive evidence for or against"}]}`;

  const reply = await visionJson<AdjudicationReply>({
    model: MODELS.adjudicate,
    images,
    labels,
    prompt,
    maxTokens: 3000,
  });

  const finals: FinalCandidate[] = [];
  let rank = 1;
  for (const entry of reply.ranking || []) {
    const idx = LETTERS.indexOf((entry.candidate || "").trim().toUpperCase());
    if (idx < 0 || idx >= top.length) continue;
    const c = top[idx];
    const address =
      (await reverseGeocode(c.lat, c.lng)) ||
      `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
    finals.push({
      rank: rank++,
      address,
      lat: c.lat,
      lng: c.lng,
      confidence: Math.max(0, Math.min(100, entry.confidence ?? 0)),
      verdict: entry.verdict ?? "",
      matchingFeatures: c.matchingFeatures,
      differences: c.differences,
      streetViewKey: c.streetViewKey,
      satelliteKey: c.closeupKey,
    });
    if (finals.length >= 5) break;
  }
  return finals;
}

/**
 * Quick-win path: when OCR found a house number and a street name, geocode
 * the address directly and verify with one Street View comparison.
 */
export async function tryQuickWin(
  fingerprint: PropertyFingerprint,
  listing: ListingData
): Promise<FinalCandidate | null> {
  const number = fingerprint.houseNumber;
  const street = fingerprint.streetClue;
  if (!number || !street) return null;

  const geo = await geocodeAddress(`${number} ${street}, ${listing.listedSuburb}, Pretoria, South Africa`);
  if (!geo || !geo.precise) return null;

  const sv = await fetchStreetViewAimedAt(geo.lat, geo.lng);
  if (!sv) return null;

  const facadePhotos = (fingerprint.facade?.bestPhotoIndexes ?? [1])
    .filter((i) => i >= 1 && i <= listing.photoUrls.length)
    .slice(0, 2)
    .map((i) => listing.photoUrls[i - 1]);

  const reply = await visionJson<{ score: number; reasoning: string }>({
    model: MODELS.compare,
    images: [...facadePhotos.map(listingImage), base64Image(sv.base64, sv.mediaType)],
    labels: [...facadePhotos.map((_, i) => `Listing photo ${i + 1}:`), "Street View of geocoded address:"],
    prompt: `The listing photos show a house whose number "${number}" on "${street}" was read from a photo. The final image is Street View of that geocoded address. Is it the same house? Respond ONLY with JSON: {"score": 0-100, "reasoning": "1-2 sentences"}`,
    maxTokens: 300,
  });

  if ((reply.score ?? 0) < 80) return null;

  const closeup = await fetchSatelliteImage(geo.lat, geo.lng, 20, "640x640", 2);
  return {
    rank: 1,
    address: geo.formattedAddress,
    lat: geo.lat,
    lng: geo.lng,
    confidence: Math.min(99, reply.score),
    verdict: `House number ${number} ${street} read directly from listing photos; Street View confirms: ${reply.reasoning}`,
    matchingFeatures: [`House number ${number} visible in photos`],
    differences: [],
    streetViewKey: sv.key,
    satelliteKey: closeup.key,
  };
}

/** Persist candidate debug data for the debug page. */
export function debugSnapshotPath(searchId: string): string {
  const dir = path.join(process.cwd(), ".cache", "debug");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${searchId}.json`);
}
