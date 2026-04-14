import type { SearchProgress, SearchResult, Candidate } from "./types";
import {
  createSearch,
  getSearch,
  updateSearchStatus,
  updateSearchFingerprint,
  updateSearchListingData,
  upsertCandidate,
  getDb,
} from "./db";
import { extractListingFromUrl } from "./listing-extractor";
import { extractFeaturesFromPhotos } from "./feature-extractor";
import { narrowSuburbs } from "./suburb-narrower";
import { scanSuburbZones } from "./satellite-scanner";
import { verifyCandidates } from "./streetview-verifier";

type ProgressCallback = (progress: SearchProgress) => void;

export async function runSearchPipeline(
  property24Url: string,
  existingSearchId?: string,
  onProgress?: ProgressCallback
): Promise<SearchResult> {
  const searchId = existingSearchId || createSearch(property24Url, "", {});

  function emitProgress(
    status: SearchProgress["status"],
    message: string,
    detail: string | null,
    percentage: number
  ) {
    updateSearchStatus(searchId, status, null);
    if (onProgress) {
      onProgress({ status, message, detail, percentage });
    }
  }

  try {
    // Step 1: Extract listing
    console.log("[PIPELINE] Step 1: Extracting listing from", property24Url);
    emitProgress("extracting_listing", "Fetching listing from Property24...", null, 5);
    const listing = await extractListingFromUrl(property24Url);
    console.log("[PIPELINE] Listing extracted:", listing.listedSuburb, listing.photoUrls.length, "photos");

    updateSearchListingData(searchId, JSON.stringify(listing));
    getDb()
      .prepare("UPDATE searches SET listed_suburb = ? WHERE id = ?")
      .run(listing.listedSuburb, searchId);

    emitProgress(
      "extracting_listing",
      "Listing extracted",
      `${listing.photoUrls.length} photos, ${listing.bedrooms || "?"} bed, ${listing.bathrooms || "?"} bath, listed in ${listing.listedSuburb}`,
      10
    );

    // Step 2: AI feature extraction
    emitProgress("analysing_photos", "Analysing listing photos with AI...", null, 15);

    if (listing.photoUrls.length === 0) {
      throw new Error("No photos found in listing. Try uploading screenshots manually.");
    }

    const fingerprint = await extractFeaturesFromPhotos(listing.photoUrls, listing.description);
    updateSearchFingerprint(searchId, JSON.stringify(fingerprint));

    const featureSummary = [
      fingerprint.roofColour ? `${fingerprint.roofColour} roof` : null,
      fingerprint.poolShape !== "none" && fingerprint.poolShape !== "unknown"
        ? `${fingerprint.poolShape} pool`
        : null,
      fingerprint.exteriorFinish !== "unknown" ? fingerprint.exteriorFinish : null,
      fingerprint.fenceType !== "unknown" ? `${fingerprint.fenceType} fence` : null,
      fingerprint.garageCount > 0 ? `${fingerprint.garageCount}x garage` : null,
    ]
      .filter(Boolean)
      .join(", ");

    emitProgress("analysing_photos", "Features extracted", featureSummary, 25);

    // Quick win check
    if (fingerprint.quickWins.length > 0) {
      const houseNumberWin = fingerprint.quickWins.find(
        (qw) => qw.type === "house_number" && qw.confidence === "high"
      );
      if (houseNumberWin) {
        emitProgress(
          "analysing_photos",
          `Quick win: House number "${houseNumberWin.value}" detected!`,
          "Skipping satellite scan — verifying via Street View",
          30
        );
      }
    }

    // Step 3: Narrow suburbs — only search the listed suburb
    emitProgress("narrowing_suburbs", `Searching ${listing.listedSuburb} only`, null, 35);
    const allZones = narrowSuburbs(listing, fingerprint);
    const primaryZone = allZones.filter((z) => z.priority === 1);

    // Step 4: Satellite scan — listed suburb only
    emitProgress("scanning_satellite", `Scanning ${listing.listedSuburb}...`, null, 40);

    const satelliteMatches = await scanSuburbZones(
      primaryZone,
      fingerprint,
      (scanned, total, suburb) => {
        const pct = 40 + Math.round((scanned / total) * 35);
        emitProgress("scanning_satellite", `Scanning ${suburb}...`, `Tile ${scanned} of ${total}`, pct);
      }
    );

    console.log(`[PIPELINE] Suburb scan complete: ${satelliteMatches.length} matches in ${listing.listedSuburb}`);
    emitProgress("scanning_satellite", `Found ${satelliteMatches.length} potential matches in ${listing.listedSuburb}`, null, 75);

    // Step 5: Street View verification
    emitProgress("verifying_streetview", "Verifying candidates via Street View...", null, 78);
    const candidates = await verifyCandidates(
      satelliteMatches,
      fingerprint,
      searchId,
      10,
      (verified, total) => {
        const pct = 78 + Math.round((verified / total) * 17);
        emitProgress("verifying_streetview", `Verifying candidate ${verified} of ${total}...`, null, pct);
      }
    );

    // Step 6: Save candidates
    for (const candidate of candidates) {
      upsertCandidate({
        searchId,
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

    // Step 7: Complete
    emitProgress("complete", "Search complete", `${candidates.length} candidates found`, 100);
    updateSearchStatus(searchId, "complete", null);

    const result = getSearch(searchId);
    return {
      id: searchId,
      listing,
      fingerprint,
      candidates,
      status: "complete",
      errorMessage: null,
      createdAt: result!.created_at,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PIPELINE] FAILED:", message, error);
    updateSearchStatus(searchId, "failed", message);
    emitProgress("failed", "Search failed", message, 0);

    return {
      id: searchId,
      listing: {} as any,
      fingerprint: null,
      candidates: [],
      status: "failed",
      errorMessage: message,
      createdAt: new Date().toISOString(),
    };
  }
}
