import { NextRequest, NextResponse } from "next/server";
import { getSearch, updateSearchStatus, upsertCandidate } from "@/lib/db";
import { narrowSuburbs } from "@/lib/suburb-narrower";
import { scanSuburbZones } from "@/lib/satellite-scanner";
import { verifyCandidates } from "@/lib/streetview-verifier";
import type { ListingData, PropertyFingerprint } from "@/lib/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const search = getSearch(id);

  if (!search) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }

  const listing: ListingData = JSON.parse(search.listing_data || "{}");
  const fingerprint: PropertyFingerprint = JSON.parse(search.fingerprint || "{}");

  if (!listing.listedSuburb) {
    return NextResponse.json({ error: "No suburb data available" }, { status: 400 });
  }

  // Get adjacent suburbs
  const allZones = narrowSuburbs(listing, fingerprint);
  const adjacentZones = allZones.filter((z) => z.priority === 2);

  if (adjacentZones.length === 0) {
    return NextResponse.json({ error: "No adjacent suburbs to search" }, { status: 400 });
  }

  const adjacentNames = adjacentZones.map((z) => z.suburb.name);

  // Update status to scanning
  updateSearchStatus(id, "scanning_satellite", null);

  // Run expansion in background
  console.log(`[EXPAND] Expanding search ${id} to: ${adjacentNames.join(", ")}`);

  (async () => {
    try {
      const satelliteMatches = await scanSuburbZones(
        adjacentZones,
        fingerprint,
        (scanned, total, suburb) => {
          console.log(`[EXPAND] Scanning ${suburb}: tile ${scanned}/${total}`);
        }
      );

      console.log(`[EXPAND] Found ${satelliteMatches.length} matches in adjacent suburbs`);

      if (satelliteMatches.length > 0) {
        updateSearchStatus(id, "verifying_streetview", null);

        const candidates = await verifyCandidates(
          satelliteMatches,
          fingerprint,
          id,
          10
        );

        for (const candidate of candidates) {
          upsertCandidate({
            searchId: id,
            address: candidate.address,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            confidenceScore: candidate.confidenceScore,
            confidenceLevel: candidate.confidenceLevel,
            satelliteMatchScore: candidate.satelliteMatchScore,
            streetviewMatchScore: candidate.streetviewMatchScore,
            featureMatches: JSON.stringify(candidate.featureMatches),
            aiExplanation: candidate.aiExplanation,
            streetviewImageUrl: candidate.streetviewImageUrl,
            satelliteImageUrl: candidate.satelliteImageUrl,
          });
        }
      }

      updateSearchStatus(id, "complete", null);
      console.log(`[EXPAND] Expansion complete`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[EXPAND] Error:`, message);
      updateSearchStatus(id, "complete", null); // Don't fail the whole search
    }
  })();

  return NextResponse.json({
    message: `Expanding search to: ${adjacentNames.join(", ")}`,
    suburbs: adjacentNames,
  });
}
