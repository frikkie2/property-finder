import { NextRequest, NextResponse } from "next/server";
import { runSearchPipeline } from "@/lib/search-pipeline";
import { getSearchHistory } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url } = body;

  if (!url || !url.includes("property24")) {
    return NextResponse.json(
      { error: "Please provide a valid Property24 listing URL" },
      { status: 400 }
    );
  }

  // Run pipeline (this blocks until complete for the POC)
  const result = await runSearchPipeline(url);

  return NextResponse.json({
    id: result.id,
    status: result.status,
    candidates: result.candidates.length,
  });
}

export async function GET() {
  const history = getSearchHistory(20);
  return NextResponse.json(history);
}
