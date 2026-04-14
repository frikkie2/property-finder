import { NextRequest, NextResponse } from "next/server";
import { runSearchPipeline } from "@/lib/search-pipeline";
import { getSearchHistory, createSearch } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url } = body;

  if (!url || !url.includes("property24")) {
    return NextResponse.json(
      { error: "Please provide a valid Property24 listing URL" },
      { status: 400 }
    );
  }

  // Create search record immediately so we have an ID
  const searchId = createSearch(url, "", {});

  // Run pipeline in the background — don't await
  console.log("[SEARCH] Starting pipeline for:", url, "searchId:", searchId);
  runSearchPipeline(url, searchId).then((result) => {
    console.log("[SEARCH] Pipeline complete:", result.status, "candidates:", result.candidates.length);
  }).catch((err) => {
    console.error("[SEARCH] Pipeline error:", err);
  });

  // Return immediately so the UI can redirect to the progress page
  return NextResponse.json({
    id: searchId,
    status: "extracting_listing",
  });
}

export async function GET() {
  const history = getSearchHistory(20);
  return NextResponse.json(history);
}
