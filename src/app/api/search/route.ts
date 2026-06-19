import { NextRequest, NextResponse } from "next/server";
import { createSearch, getSearchHistory, updateSearchListingData, getDb } from "@/lib/db";
import { extractListingFromUrl } from "@/lib/listing-extractor";
import { runManualPhotoSearch } from "@/lib/manual-search";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url, suburbs } = body as { url?: string; suburbs?: string[] };

  if (!url || !url.includes("property24")) {
    return NextResponse.json(
      { error: "Please provide a valid Property24 listing URL" },
      { status: 400 }
    );
  }

  const searchId = createSearch(url, "", {});
  getDb().prepare("UPDATE searches SET status = ? WHERE id = ?").run("extracting_listing", searchId);

  // Scrape the listing, then match its photos against the chosen indexed
  // suburb(s) — the same street-index matcher used for manual uploads.
  (async () => {
    try {
      const listing = await extractListingFromUrl(url);
      updateSearchListingData(searchId, JSON.stringify(listing));
      getDb().prepare("UPDATE searches SET listed_suburb = ? WHERE id = ?").run(listing.listedSuburb, searchId);
      await runManualPhotoSearch(searchId, listing, suburbs);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[SEARCH] error:", message);
      getDb().prepare("UPDATE searches SET status = 'failed', error_message = ? WHERE id = ?").run(message, searchId);
    }
  })();

  return NextResponse.json({ id: searchId, status: "extracting_listing" });
}

export async function GET() {
  return NextResponse.json(getSearchHistory(20));
}
