import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache", "maps");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(prefix: string, params: string): string {
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

export async function fetchSatelliteImage(
  lat: number,
  lng: number,
  zoom: number = 19,
  size: string = "640x640"
): Promise<{ imageBuffer: Buffer; base64: string }> {
  const key = cacheKey("sat", `${lat},${lng},${zoom},${size}`);
  const cached = getCached(key);
  if (cached) {
    return { imageBuffer: cached, base64: cached.toString("base64") };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?` +
    `center=${lat},${lng}&zoom=${zoom}&size=${size}` +
    `&maptype=satellite&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Maps Static API error: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  setCache(key, buffer);

  return { imageBuffer: buffer, base64: buffer.toString("base64") };
}

export async function fetchStreetViewImage(
  lat: number,
  lng: number,
  heading: number = 0,
  size: string = "640x480"
): Promise<{ imageBuffer: Buffer; base64: string } | null> {
  const key = cacheKey("sv", `${lat},${lng},${heading},${size}`);
  const cached = getCached(key);
  if (cached) {
    return { imageBuffer: cached, base64: cached.toString("base64") };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  // First check if Street View is available at this location
  const metaUrl =
    `https://maps.googleapis.com/maps/api/streetview/metadata?` +
    `location=${lat},${lng}&key=${apiKey}`;

  const metaResponse = await fetch(metaUrl);
  const meta = await metaResponse.json();

  if (meta.status !== "OK") return null;

  const url =
    `https://maps.googleapis.com/maps/api/streetview?` +
    `location=${lat},${lng}&heading=${heading}&size=${size}` +
    `&pitch=0&fov=90&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  setCache(key, buffer);

  return { imageBuffer: buffer, base64: buffer.toString("base64") };
}

export async function fetchStreetViewMultipleAngles(
  lat: number,
  lng: number
): Promise<{ heading: number; base64: string }[]> {
  const headings = [0, 90, 180, 270];
  const results: { heading: number; base64: string }[] = [];

  for (const heading of headings) {
    const image = await fetchStreetViewImage(lat, lng, heading);
    if (image) {
      results.push({ heading, base64: image.base64 });
    }
  }

  return results;
}

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?` +
    `address=${encodeURIComponent(address)}&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK" || !data.results.length) return null;

  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?` +
    `latlng=${lat},${lng}&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK" || !data.results.length) return null;
  return data.results[0].formatted_address;
}
