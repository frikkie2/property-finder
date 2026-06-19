import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { buildStreetIndex, loadStreetIndex, listStreetIndexes, streetSlug } from "@/lib/street-index";

const INDEX_DIR = path.join(process.cwd(), ".cache", "street-index");

function statusPath(slug: string) {
  return path.join(INDEX_DIR, `${slug}.status.json`);
}
function writeStatus(slug: string, status: Record<string, unknown>) {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  fs.writeFileSync(statusPath(slug), JSON.stringify(status));
}

// POST { street, suburb, maxNumber? } → starts a background index build.
export async function POST(request: NextRequest) {
  const { street, suburb, maxNumber } = await request.json();
  if (!street || !suburb) {
    return NextResponse.json({ error: "street and suburb are required" }, { status: 400 });
  }
  const slug = streetSlug(street, suburb);
  writeStatus(slug, { state: "running", processed: 0, total: maxNumber ?? 400, kept: 0, startedAt: new Date().toISOString() });

  buildStreetIndex(street, suburb, {
    maxNumber,
    onProgress: (processed, total, kept) => {
      writeStatus(slug, { state: "running", processed, total, kept });
    },
  })
    .then((index) => {
      writeStatus(slug, { state: "complete", processed: index.houseCount, total: index.houseCount, kept: index.houseCount, finishedAt: new Date().toISOString() });
      console.log(`[INDEX] ${slug} complete: ${index.houseCount} houses`);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      writeStatus(slug, { state: "failed", error: message });
      console.error(`[INDEX] ${slug} failed:`, message);
    });

  return NextResponse.json({ slug, status: "running" });
}

// GET ?slug=... → status + summary; no slug → list all indexes.
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({
      indexes: listStreetIndexes().map((i) => ({ slug: i.slug, street: i.street, suburb: i.suburb, houseCount: i.houseCount, builtAt: i.builtAt })),
    });
  }
  const sp = statusPath(slug);
  const status = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, "utf-8")) : null;
  const index = loadStreetIndex(slug);
  return NextResponse.json({
    slug,
    status,
    index: index
      ? { street: index.street, suburb: index.suburb, houseCount: index.houseCount, builtAt: index.builtAt,
          houses: index.houses.map((h) => ({ address: h.address, lat: h.lat, lng: h.lng, svKey: h.svKey, features: h.features })) }
      : null,
  });
}
