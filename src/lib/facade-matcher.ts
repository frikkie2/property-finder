import { fetchStreetViewMultipleAngles } from "./google-maps";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Building } from "./osm-api";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const CACHE_DIR = path.join(process.cwd(), ".cache", "facade-scores");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(listingPhotoHash: string, streetViewKey: string): string {
  return crypto.createHash("md5").update(`${listingPhotoHash}-${streetViewKey}`).digest("hex");
}

function getCachedScore(key: string): FacadeScore | null {
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as FacadeScore;
    } catch {
      return null;
    }
  }
  return null;
}

function setCachedScore(key: string, score: FacadeScore) {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(score));
}

export interface FacadeScore {
  score: number; // 0-100
  reasoning: string;
  matchingFeatures: string[];
  differences: string[];
}

export interface ScoredCandidate {
  building: Building;
  score: FacadeScore;
  streetViewKey: string; // for displaying the cached image
  streetViewImageUrl: string;
}

/**
 * Compare a listing facade photo (base64) to a Street View image (base64).
 * Returns a similarity score and reasoning.
 */
async function compareFacades(
  listingPhotoBase64: string,
  listingMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  streetViewBase64: string,
  streetViewMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
): Promise<FacadeScore> {
  const client = getClient();

  const prompt = `You are comparing TWO PHOTOS of houses to determine if they are the SAME property.

IMAGE 1 is a listing photo showing the front of a house.
IMAGE 2 is a Google Street View image of a house at a candidate address.

Look at structural and visual features:
- Wall material and colour (face brick, plaster, painted — exact colour)
- Roof type (tiles, sheeting, thatch) and colour
- Number of storeys
- Gate style (palisade, wooden, solid wall)
- Fence/wall style and height
- Garage doors (count, colour, type)
- Window pattern and layout
- Driveway style and material
- Distinctive features (stone work, unique decorations, specific tile patterns)
- Trees and vegetation in front

IMPORTANT CAVEATS:
- Street View can be 1-5 years old — paint may have changed, garden may have grown
- Different angles and lighting affect appearance
- Focus on STRUCTURAL features (they don't change), not cosmetic (paint, garden)
- Vehicles parked in Street View don't count

Score the match from 0-100:
- 0-20 = Clearly different house
- 21-40 = Most features don't match
- 41-60 = Some features match, many don't
- 61-80 = Most features match, minor differences
- 81-100 = Very likely the same house

Respond with ONLY valid JSON:

{
  "score": 0-100,
  "reasoning": "1-2 sentence explanation",
  "matchingFeatures": ["feature1", "feature2"],
  "differences": ["difference1"]
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: listingMediaType, data: listingPhotoBase64 },
          },
          {
            type: "image",
            source: { type: "base64", media_type: streetViewMediaType, data: streetViewBase64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const responseText = textBlock ? (textBlock as { type: "text"; text: string }).text : "";

  // Parse JSON
  let jsonStr = responseText.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : 0,
      reasoning: parsed.reasoning || "",
      matchingFeatures: parsed.matchingFeatures || [],
      differences: parsed.differences || [],
    };
  } catch {
    return {
      score: 0,
      reasoning: "Failed to parse AI response",
      matchingFeatures: [],
      differences: [],
    };
  }
}

/**
 * Score a building by fetching its Street View and comparing to the listing photo.
 * Returns null if no Street View is available for this building.
 */
export async function scoreBuilding(
  building: Building,
  listingPhotoBase64: string,
  listingPhotoHash: string,
  listingMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
): Promise<ScoredCandidate | null> {
  // Fetch Street View at the building's centre, multiple angles
  const streetViews = await fetchStreetViewMultipleAngles(building.center.lat, building.center.lng);
  if (streetViews.length === 0) return null;

  // Compare to EACH angle and take the best score
  let bestScore: FacadeScore | null = null;
  let bestKey: string | null = null;

  for (const sv of streetViews) {
    const cacheKeyStr = cacheKey(listingPhotoHash, sv.key);
    let score = getCachedScore(cacheKeyStr);

    if (!score) {
      score = await compareFacades(listingPhotoBase64, listingMediaType, sv.base64, sv.mediaType);
      setCachedScore(cacheKeyStr, score);
    }

    if (!bestScore || score.score > bestScore.score) {
      bestScore = score;
      bestKey = sv.key;
    }
  }

  if (!bestScore || !bestKey) return null;

  return {
    building,
    score: bestScore,
    streetViewKey: bestKey,
    streetViewImageUrl: `/api/images/${bestKey}`,
  };
}

/**
 * Score many buildings in parallel batches, return them all ranked by score.
 */
export async function scoreBuildingsInParallel(
  buildings: Building[],
  listingPhotoBase64: string,
  listingPhotoHash: string,
  listingMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  onProgress?: (scored: number, total: number, topScore: number) => void,
  batchSize: number = 5
): Promise<ScoredCandidate[]> {
  const results: ScoredCandidate[] = [];

  for (let i = 0; i < buildings.length; i += batchSize) {
    const batch = buildings.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((b) => scoreBuilding(b, listingPhotoBase64, listingPhotoHash, listingMediaType))
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }

    if (onProgress) {
      const topScore = Math.max(0, ...results.map((r) => r.score.score));
      onProgress(Math.min(i + batch.length, buildings.length), buildings.length, topScore);
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score.score - a.score.score);
  return results;
}

/**
 * Download a listing photo and return it as base64 for comparison.
 */
export async function downloadListingPhoto(url: string): Promise<{
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  hash: string;
}> {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const base64 = buffer.toString("base64");
  const hash = crypto.createHash("md5").update(buffer).digest("hex");

  const contentType = response.headers.get("content-type") || "image/jpeg";
  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
  if (contentType.includes("png")) mediaType = "image/png";
  else if (contentType.includes("webp")) mediaType = "image/webp";
  else if (contentType.includes("gif")) mediaType = "image/gif";

  return { base64, mediaType, hash };
}
