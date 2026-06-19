import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache", "maps");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function cacheKey(prefix: string, params: string): string {
  const hash = crypto.createHash("md5").update(params).digest("hex");
  return `${prefix}-${hash}`;
}

function getCached(key: string): Buffer | null {
  const filePath = path.join(CACHE_DIR, `${key}.jpg`);
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
  return null;
}

function setCache(key: string, data: Buffer) {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.jpg`), data);
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "image/webp";
  return "image/png";
}

export interface MapImage {
  imageBuffer: Buffer;
  base64: string;
  mediaType: ImageMediaType;
  key: string;
}

/**
 * Fetch a satellite tile. `scale: 2` returns double-density pixels
 * (e.g. zoom 18 + scale 2 = zoom-19 detail in a zoom-18 footprint)
 * at no extra API cost.
 */
export async function fetchSatelliteImage(
  lat: number,
  lng: number,
  zoom: number = 19,
  size: string = "640x640",
  scale: 1 | 2 = 1
): Promise<MapImage> {
  const key = cacheKey("sat", `${lat.toFixed(6)},${lng.toFixed(6)},${zoom},${size},${scale}`);
  const cached = getCached(key);
  if (cached) {
    return { imageBuffer: cached, base64: cached.toString("base64"), mediaType: detectMediaType(cached), key };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?` +
    `center=${lat},${lng}&zoom=${zoom}&size=${size}&scale=${scale}` +
    `&maptype=satellite&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Maps Static API error: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  setCache(key, buffer);

  return { imageBuffer: buffer, base64: buffer.toString("base64"), mediaType: detectMediaType(buffer), key };
}

export interface StreetViewMeta {
  panoLat: number;
  panoLng: number;
  panoId: string;
  date: string | null;
}

/**
 * Look up the nearest Street View panorama to a location.
 * Returns null when no coverage exists within the radius.
 */
export async function fetchStreetViewMetadata(
  lat: number,
  lng: number,
  radius: number = 60
): Promise<StreetViewMeta | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/streetview/metadata?` +
    `location=${lat},${lng}&radius=${radius}&source=outdoor&key=${apiKey}`;

  const response = await fetch(url);
  const meta = await response.json();
  if (meta.status !== "OK" || !meta.location) return null;

  return {
    panoLat: meta.location.lat,
    panoLng: meta.location.lng,
    panoId: meta.pano_id,
    date: meta.date || null,
  };
}

/** Compass bearing in degrees from point A to point B. */
export function bearingBetween(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const φ1 = (fromLat * Math.PI) / 180;
  const φ2 = (toLat * Math.PI) / 180;
  const Δλ = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/**
 * Fetch a Street View image AIMED AT a target location: finds the nearest
 * panorama, computes the bearing from the camera to the target, and requests
 * that heading. (The old code requested fixed compass headings 0/90/180/270,
 * which mostly photographed random directions and quadrupled cost.)
 */
export async function fetchStreetViewAimedAt(
  targetLat: number,
  targetLng: number,
  fov: number = 90
): Promise<(MapImage & { heading: number; panoDistanceMeters: number; panoDate: string | null }) | null> {
  const meta = await fetchStreetViewMetadata(targetLat, targetLng);
  if (!meta) return null;

  const heading = Math.round(bearingBetween(meta.panoLat, meta.panoLng, targetLat, targetLng));
  const distance = haversineMeters(meta.panoLat, meta.panoLng, targetLat, targetLng);

  const key = cacheKey("svaim", `${meta.panoId},${heading},${fov}`);
  const cached = getCached(key);
  if (cached) {
    return {
      imageBuffer: cached, base64: cached.toString("base64"), mediaType: detectMediaType(cached),
      key, heading, panoDistanceMeters: distance, panoDate: meta.date,
    };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/streetview?` +
    `pano=${meta.panoId}&heading=${heading}&size=640x480&pitch=0&fov=${fov}&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  setCache(key, buffer);

  return {
    imageBuffer: buffer, base64: buffer.toString("base64"), mediaType: detectMediaType(buffer),
    key, heading, panoDistanceMeters: distance, panoDate: meta.date,
  };
}

export interface StreetViewShot {
  key: string;
  heading: number;
  label: string;
}

/**
 * Capture several Street View headings from the nearest pano to a target:
 *   - straight on (bearing to the house)
 *   - angled ±offset (catches houses set back behind walls/trees, seen obliquely)
 *   - the OPPOSITE direction (the across-the-road streetscape that appears in
 *     the background of listing photos shot from inside looking out)
 * One metadata lookup, N cached image fetches. Returns [] if no coverage.
 */
export async function fetchStreetViewHeadings(
  targetLat: number,
  targetLng: number,
  fov: number = 90
): Promise<{ shots: StreetViewShot[]; panoDate: string | null }> {
  const meta = await fetchStreetViewMetadata(targetLat, targetLng);
  if (!meta) return { shots: [], panoDate: null };

  const toHouse = Math.round(bearingBetween(meta.panoLat, meta.panoLng, targetLat, targetLng));
  const plan: { heading: number; label: string }[] = [
    { heading: toHouse, label: "head-on" },
    { heading: (toHouse + 40) % 360, label: "angled-right" },
    { heading: (toHouse + 320) % 360, label: "angled-left" },
    { heading: (toHouse + 180) % 360, label: "opposite (across-street view)" },
  ];

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const shots: StreetViewShot[] = [];
  for (const p of plan) {
    const key = cacheKey("svaim", `${meta.panoId},${p.heading},${fov}`);
    if (!getCached(key)) {
      const url =
        `https://maps.googleapis.com/maps/api/streetview?` +
        `pano=${meta.panoId}&heading=${p.heading}&size=640x480&pitch=0&fov=${fov}&key=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      setCache(key, Buffer.from(await response.arrayBuffer()));
    }
    shots.push({ key, heading: p.heading, label: p.label });
  }
  return { shots, panoDate: meta.date };
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; formattedAddress: string; precise: boolean } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?` +
    `address=${encodeURIComponent(address)}&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== "OK" || !data.results.length) return null;

  const result = data.results[0];
  const loc = result.geometry.location;
  return {
    lat: loc.lat,
    lng: loc.lng,
    formattedAddress: result.formatted_address,
    precise: result.geometry.location_type === "ROOFTOP" || result.types.includes("street_address"),
  };
}

/** Reverse geocode to the nearest street address. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?` +
    `latlng=${lat},${lng}&result_type=street_address|premise&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== "OK" || !data.results.length) return null;
  return data.results[0].formatted_address;
}

export interface ReverseStreet {
  route: string | null;        // e.g. "Kent Road"
  streetNumber: number | null; // e.g. 243
  suburb: string | null;       // sublocality
}

/**
 * Reverse geocode returning structured street components — used to discover
 * the streets (and house-number ranges) present in a suburb.
 */
export async function reverseGeocodeStreet(lat: number, lng: number): Promise<ReverseStreet | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?` +
    `latlng=${lat},${lng}&result_type=street_address|premise|route&key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== "OK" || !data.results.length) return null;

  // Prefer a result that has a route component.
  for (const result of data.results) {
    const comps: { long_name: string; types: string[] }[] = result.address_components || [];
    const route = comps.find((c) => c.types.includes("route"))?.long_name ?? null;
    if (!route) continue;
    const numStr = comps.find((c) => c.types.includes("street_number"))?.long_name ?? null;
    const suburb =
      comps.find((c) => c.types.includes("sublocality") || c.types.includes("neighborhood"))?.long_name ?? null;
    const n = numStr ? parseInt(numStr.replace(/[^0-9]/g, ""), 10) : null;
    return { route, streetNumber: Number.isNaN(n as number) ? null : n, suburb };
  }
  return null;
}
