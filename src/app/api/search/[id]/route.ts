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
  // Map DB rows (snake_case) to the camelCase Candidate shape the UI expects.
  // Scores are stored 0-100; the UI displays them as-is.
  const candidates = search.candidates.map((c: any) => ({
    id: c.id,
    listingId: c.search_id,
    address: c.address,
    latitude: c.latitude,
    longitude: c.longitude,
    confidenceScore: c.confidence_score,
    confidenceLevel: c.confidence_level,
    satelliteMatchScore: c.satellite_match_score,
    streetviewMatchScore: c.streetview_match_score,
    featureMatches: JSON.parse(c.feature_matches || "[]"),
    aiExplanation: c.ai_explanation,
    streetviewImageUrl: c.streetview_image_url,
    streetviewImageUrls: c.streetview_image_urls ? JSON.parse(c.streetview_image_urls) : null,
    satelliteImageUrl: c.satellite_image_url,
    status: c.status,
    confirmedAt: c.confirmed_at,
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
