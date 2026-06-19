/**
 * Targeted second-pass scan: re-examine ALL sweep candidates of a search via
 * Street View, looking only for the listing's most distinctive street-visible
 * features (e.g. the red sliding gate). Usage:
 *   node scripts/red-gate-scan.mjs <searchId>
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";

const searchId = process.argv[2] || "a8529ea7-8d9a-4a72-9401-f53dd6ab94f7";

// --- env ---
const env = fs.readFileSync(".env.local", "utf-8");
const GOOGLE_KEY = env.match(/GOOGLE_MAPS_API_KEY=(.+)/)[1].trim();
const ANTHROPIC_KEY = env.match(/ANTHROPIC_API_KEY=(.+)/)[1].trim();

// --- load search ---
const db = new Database("data/property-finder.db");
const row = db.prepare("SELECT fingerprint, pipeline_log FROM searches WHERE id = ?").get(searchId);
const fingerprint = JSON.parse(row.fingerprint);
const log = JSON.parse(row.pipeline_log);
const bounds = log.find((e) => e.stage === "suburb_resolved").bounds;
const aerialHash = crypto.createHash("md5").update(JSON.stringify(fingerprint.aerial)).digest("hex");

// --- replicate tile grid + sweep cache keys (must match src/lib/tile-sweep.ts) ---
const SWEEP_ZOOM = 18, TILE_PX = 640, OVERLAP = 0.12;
function generateTiles(b) {
  const midLat = (b.north + b.south) / 2;
  const mpp = (156543.03392 * Math.cos((midLat * Math.PI) / 180)) / 2 ** SWEEP_ZOOM;
  const step = mpp * TILE_PX * (1 - OVERLAP);
  const latStep = step / 111320;
  const lngStep = step / (111320 * Math.cos((midLat * Math.PI) / 180));
  const tiles = [];
  for (let lat = b.south + latStep / 2; lat < b.north + latStep / 2; lat += latStep)
    for (let lng = b.west + lngStep / 2; lng < b.east + lngStep / 2; lng += lngStep)
      tiles.push({ lat: Math.min(lat, b.north), lng: Math.min(lng, b.east) });
  return tiles;
}
const tiles = generateTiles(bounds);
const candidates = [];
for (const t of tiles) {
  const key = crypto.createHash("md5")
    .update(`v2-${t.lat.toFixed(6)},${t.lng.toFixed(6)}-${aerialHash}`).digest("hex");
  const file = path.join(".cache", "sweep", `${key}.json`);
  if (fs.existsSync(file)) {
    try { candidates.push(...JSON.parse(fs.readFileSync(file, "utf-8"))); } catch {}
  }
}
// dedupe 28m, keep higher confidence
const RANK = { high: 3, medium: 2, low: 1 };
candidates.sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
const kept = [];
for (const c of candidates) {
  const dup = kept.some((k) => {
    const dLat = (k.lat - c.lat) * 111320;
    const dLng = (k.lng - c.lng) * 111320 * Math.cos((c.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng) < 28;
  });
  if (!dup) kept.push(c);
}
console.log(`Loaded ${candidates.length} sweep flags -> ${kept.length} unique stands`);

// --- street view aimed fetch (cached) ---
const MAPS_CACHE = path.join(".cache", "maps");
fs.mkdirSync(MAPS_CACHE, { recursive: true });
function bearing(aLat, aLng, bLat, bLng) {
  const p1 = (aLat * Math.PI) / 180, p2 = (bLat * Math.PI) / 180, dl = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
async function aimedSv(lat, lng) {
  const meta = await (await fetch(
    `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=60&source=outdoor&key=${GOOGLE_KEY}`
  )).json();
  if (meta.status !== "OK" || !meta.location) return null;
  const h = Math.round(bearing(meta.location.lat, meta.location.lng, lat, lng));
  const key = "svaim-" + crypto.createHash("md5").update(`${meta.pano_id},${h},90`).digest("hex");
  const file = path.join(MAPS_CACHE, `${key}.jpg`);
  if (fs.existsSync(file)) return { key, b64: fs.readFileSync(file).toString("base64") };
  const img = await fetch(
    `https://maps.googleapis.com/maps/api/streetview?pano=${meta.pano_id}&heading=${h}&size=640x480&pitch=0&fov=90&key=${GOOGLE_KEY}`
  );
  if (!img.ok) return null;
  const buf = Buffer.from(await img.arrayBuffer());
  fs.writeFileSync(file, buf);
  return { key, b64: buf.toString("base64") };
}

// --- the narrow question ---
const PROMPT = `Look at this Google Street View photo of a residential property in Pretoria.

We are looking for a property with these street-visible features:
1. A RED sliding driveway gate (large, solid or slatted, distinctly red/maroon)
2. Brown garage doors with GREEN-painted trim/fascia
3. A herringbone-pattern clay brick paved driveway
4. Face brick walls, dark charcoal tiled roof, single storey

Note: Street View can be a few years old; a gate may have been repainted since. Judge what you see.

Respond ONLY with JSON:
{"redGate": true/false, "greenTrim": true/false, "herringbone": true/false, "faceBrickDarkRoof": true/false, "obscured": true/false, "note": "max 12 words"}`;

const RESULT_CACHE = path.join(".cache", "redgate");
fs.mkdirSync(RESULT_CACHE, { recursive: true });

async function check(c) {
  const sv = await aimedSv(c.lat, c.lng);
  if (!sv) return null;
  const cacheFile = path.join(RESULT_CACHE, `${sv.key}.json`);
  if (fs.existsSync(cacheFile)) return { ...JSON.parse(fs.readFileSync(cacheFile, "utf-8")), c, svKey: sv.key };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: sv.b64 } },
        { type: "text", text: PROMPT },
      ]}],
    }),
  });
  const data = await r.json();
  if (!data.content) { console.error("API error:", JSON.stringify(data).slice(0, 200)); return null; }
  let text = data.content.find((b) => b.type === "text")?.text ?? "";
  text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const start = text.indexOf("{");
  const verdict = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
  fs.writeFileSync(cacheFile, JSON.stringify(verdict));
  return { ...verdict, c, svKey: sv.key };
}

let done = 0;
const results = [];
const queue = [...kept];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const c = queue.shift();
    try {
      const r = await check(c);
      if (r) results.push(r);
    } catch (e) { console.error("fail:", e.message); }
    if (++done % 25 === 0) console.log(`checked ${done}/${kept.length}`);
  }
}));

const hits = results
  .map((r) => ({ ...r, score: (r.redGate ? 4 : 0) + (r.greenTrim ? 2 : 0) + (r.herringbone ? 2 : 0) + (r.faceBrickDarkRoof ? 1 : 0) }))
  .filter((r) => r.score >= 2)
  .sort((a, b) => b.score - a.score);

console.log(`\n=== ${results.length} stands checked, ${hits.length} with feature hits ===`);
for (const h of hits.slice(0, 15)) {
  const geo = await (await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${h.c.lat},${h.c.lng}&result_type=street_address|premise&key=${GOOGLE_KEY}`
  )).json();
  const addr = geo.results?.[0]?.formatted_address ?? `${h.c.lat.toFixed(6)},${h.c.lng.toFixed(6)}`;
  console.log(`score ${h.score} | redGate=${h.redGate} greenTrim=${h.greenTrim} herringbone=${h.herringbone} brick/roof=${h.faceBrickDarkRoof} obscured=${h.obscured}`);
  console.log(`   ${addr}`);
  console.log(`   note: ${h.note} | image: .cache/maps/${h.svKey}.jpg | ${h.c.lat},${h.c.lng}`);
}
