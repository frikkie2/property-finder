import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { buildSuburbIndex } from "@/lib/street-index";

const DIR = path.join(process.cwd(), ".cache", "street-index");

function statusPath(suburb: string) {
  const slug = suburb.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return path.join(DIR, `suburb-${slug}.status.json`);
}
function writeStatus(suburb: string, status: Record<string, unknown>) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(statusPath(suburb), JSON.stringify(status));
}

// POST { suburb } → start a background full-suburb index build.
export async function POST(request: NextRequest) {
  const { suburb } = await request.json();
  if (!suburb) return NextResponse.json({ error: "suburb is required" }, { status: 400 });

  writeStatus(suburb, { state: "running", phase: "starting", streetsDone: 0, streetsTotal: 0, housesKept: 0, startedAt: new Date().toISOString() });

  buildSuburbIndex(suburb, {
    onProgress: (info) => writeStatus(suburb, { state: "running", ...info }),
  })
    .then((r) => {
      writeStatus(suburb, { state: "complete", phase: "done", streetsDone: r.streets, streetsTotal: r.streets, housesKept: r.houses, finishedAt: new Date().toISOString() });
      console.log(`[INDEX-SUBURB] ${suburb} complete: ${r.streets} streets, ${r.houses} houses`);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      writeStatus(suburb, { state: "failed", error: message });
      console.error(`[INDEX-SUBURB] ${suburb} failed:`, message);
    });

  return NextResponse.json({ suburb, status: "running" });
}

// GET ?suburb=... → status
export async function GET(request: NextRequest) {
  const suburb = request.nextUrl.searchParams.get("suburb");
  if (!suburb) return NextResponse.json({ error: "suburb query param required" }, { status: 400 });
  const sp = statusPath(suburb);
  const status = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, "utf-8")) : null;
  return NextResponse.json({ suburb, status });
}
