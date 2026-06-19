/**
 * Definitive one-candidate verification: listing photos (by URL) vs the
 * candidate's Street View + zoom-20 satellite, judged by Opus.
 * Usage: node scripts/verify-candidate.mjs <searchId> <lat> <lng>
 */
import fs from "fs";
import crypto from "crypto";
import path from "path";
import Database from "better-sqlite3";

const [searchId, latS, lngS] = process.argv.slice(2);
const lat = parseFloat(latS), lng = parseFloat(lngS);

const env = fs.readFileSync(".env.local", "utf-8");
const GOOGLE_KEY = env.match(/GOOGLE_MAPS_API_KEY=(.+)/)[1].trim();
const ANTHROPIC_KEY = env.match(/ANTHROPIC_API_KEY=(.+)/)[1].trim();

const db = new Database("data/property-finder.db");
const row = db.prepare("SELECT listing_data, fingerprint FROM searches WHERE id = ?").get(searchId);
const listing = JSON.parse(row.listing_data);
const fp = JSON.parse(row.fingerprint);

// listing photos: facade picks + first few exteriors
const idx = [...new Set([...(fp.facade?.bestPhotoIndexes ?? []), 1, 2, 3, 4])].slice(0, 6);
const photoUrls = idx.map((i) => listing.photoUrls[i - 1]).filter(Boolean);

// satellite zoom 20
const satUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&scale=2&maptype=satellite&key=${GOOGLE_KEY}`;
const satB64 = Buffer.from(await (await fetch(satUrl)).arrayBuffer()).toString("base64");

// aimed street view
const meta = await (await fetch(
  `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=60&source=outdoor&key=${GOOGLE_KEY}`
)).json();
const brg = (() => {
  const p1 = (meta.location.lat * Math.PI) / 180, p2 = (lat * Math.PI) / 180, dl = ((lng - meta.location.lng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.round((((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360);
})();
const svB64 = Buffer.from(await (await fetch(
  `https://maps.googleapis.com/maps/api/streetview?pano=${meta.pano_id}&heading=${brg}&size=640x480&fov=90&key=${GOOGLE_KEY}`
)).arrayBuffer()).toString("base64");

const content = [];
photoUrls.forEach((u, i) => {
  content.push({ type: "text", text: `Listing photo ${i + 1}:` });
  content.push({ type: "image", source: { type: "url", url: u } });
});
content.push({ type: "text", text: `Candidate — Street View (imagery date ${meta.date || "?"}):` });
content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: svB64 } });
content.push({ type: "text", text: "Candidate — satellite close-up (centre of image):" });
content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: satB64 } });
content.push({
  type: "text",
  text: `Is the candidate property THE SAME HOUSE as in the listing photos?

Listing context: ${listing.bedrooms} bed house in ${listing.listedSuburb}, erf ${listing.plotSize} m². Description mentions: swimming pool and jacuzzi, lush garden, single storey.
Facade signature from photos: """${fp.facade?.summary}"""

Compare PERMANENT structure meticulously: roof shape/tile profile and colour, garage door count/position/type, gate design, boundary wall, window positions, driveway paving pattern, any distinctive objects (wall cross, post boxes). Street View may be a few years older than the listing photos — repainting is possible, structure is not.

Respond ONLY with JSON:
{"sameHouse": "yes|likely|unsure|no", "confidence": 0-100, "evidence": ["each decisive observation, for AND against"], "verdict": "2-3 sentences"}`,
});

const r = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 1500, thinking: { type: "adaptive" }, messages: [{ role: "user", content }] }),
});
const data = await r.json();
if (!data.content) { console.error(JSON.stringify(data).slice(0, 500)); process.exit(1); }
console.log(data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"));
