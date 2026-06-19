import { NextRequest, NextResponse } from "next/server";
import { getSearch, getDb } from "@/lib/db";
import { runManualPhotoSearch } from "@/lib/manual-search";
import type { ListingData } from "@/lib/types";

// Re-run the manual photo match for an existing upload (photos already on disk).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const search = getSearch(id);
  if (!search) return NextResponse.json({ error: "Search not found" }, { status: 404 });

  const listing = JSON.parse(search.listing_data || "{}") as ListingData;
  if (!listing.photoUrls?.length) {
    return NextResponse.json({ error: "No uploaded photos on this search" }, { status: 400 });
  }

  getDb().prepare("UPDATE searches SET status = ?, error_message = NULL WHERE id = ?").run("analysing_photos", id);
  runManualPhotoSearch(id, listing).catch((err) => console.error("[REMATCH] error:", err));
  return NextResponse.json({ id, status: "analysing_photos" });
}
