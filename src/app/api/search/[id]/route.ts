import { NextRequest, NextResponse } from "next/server";
import { getSearch } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const search = getSearch(id);

  if (!search) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }

  const listingData = search.listing_data ? JSON.parse(search.listing_data) : null;
  const fingerprint = search.fingerprint ? JSON.parse(search.fingerprint) : null;
  const candidates = search.candidates.map((c: any) => ({
    ...c,
    feature_matches: JSON.parse(c.feature_matches || "[]"),
  }));

  const progressDetail = search.progress_detail ? JSON.parse(search.progress_detail) : null;
  const pipelineLog = search.pipeline_log ? JSON.parse(search.pipeline_log) : [];
  const buildingsFound = search.buildings_found ? JSON.parse(search.buildings_found) : [];

  return NextResponse.json({
    id: search.id,
    property24Url: search.property24_url,
    listedSuburb: search.listed_suburb,
    listing: listingData,
    fingerprint,
    candidates,
    status: search.status,
    progressDetail,
    pipelineLog,
    buildingsFound,
    errorMessage: search.error_message,
    createdAt: search.created_at,
  });
}
