import type { SearchProgress, SearchResult, Candidate } from "./types";
import {
  createSearch,
  getSearch,
  updateSearchStatus,
  updateSearchFingerprint,
  updateSearchListingData,
  updateSearchProgressDetail,
  appendPipelineLog,
  saveBuildingsFound,
  upsertCandidate,
  getDb,
} from "./db";
import { extractListingFromUrl } from "./listing-extractor";
import { extractFeaturesFromPhotos } from "./feature-extractor";
import { narrowSuburbs } from "./suburb-narrower";
import { fetchBuildingsInSuburb, filterResidentialBuildings } from "./osm-api";
import { downloadListingPhoto, scoreBuildingsInParallel } from "./facade-matcher";
import { v4 as uuidv4 } from "uuid";

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
    emitProgress("narrowing_suburbs", `Searching ${listing.listedSuburb} only`, null, 30);
    const allZones = narrowSuburbs(listing, fingerprint);
    const primaryZone = allZones.filter((z) => z.priority === 1);

    if (primaryZone.length === 0) {
      throw new Error(`Unknown suburb: ${listing.listedSuburb}`);
    }

    // Step 4: Fetch all buildings in the suburb from OpenStreetMap
    emitProgress("scanning_satellite", `Fetching building data for ${primaryZone[0].suburb.name}...`, null, 35);
    appendPipelineLog(searchId, { stage: "osm_fetch_start", suburb: primaryZone[0].suburb.name });

    const allBuildings = await fetchBuildingsInSuburb(primaryZone[0].suburb);
    const residentialBuildings = filterResidentialBuildings(allBuildings);

    appendPipelineLog(searchId, {
      stage: "osm_fetch_complete",
      totalBuildings: allBuildings.length,
      residentialBuildings: residentialBuildings.length,
    });

    console.log(`[PIPELINE] OSM: ${allBuildings.length} total, ${residentialBuildings.length} residential`);
    emitProgress("scanning_satellite", `Found ${residentialBuildings.length} residential buildings in ${primaryZone[0].suburb.name}`, null, 40);

    if (residentialBuildings.length === 0) {
      throw new Error(`No residential buildings found in ${primaryZone[0].suburb.name} via OSM`);
    }

    // Step 5: Select the front-of-house photo and download it
    const frontIdx = (fingerprint as { bestFrontOfHousePhotoIndex?: number }).bestFrontOfHousePhotoIndex;
    const photoIdx = frontIdx && frontIdx > 0 && frontIdx <= listing.photoUrls.length ? frontIdx - 1 : 0;
    const frontPhotoUrl = listing.photoUrls[photoIdx];

    emitProgress("scanning_satellite", `Downloading front-of-house photo (photo #${photoIdx + 1})...`, null, 42);
    const listingPhoto = await downloadListingPhoto(frontPhotoUrl);

    appendPipelineLog(searchId, {
      stage: "facade_photo_selected",
      photoIndex: photoIdx + 1,
      photoUrl: frontPhotoUrl,
      photoHash: listingPhoto.hash,
    });

    // Step 6: Compare listing photo to Street View of every residential building
    emitProgress("verifying_streetview", `Comparing facade to ${residentialBuildings.length} buildings via Street View...`, null, 45);

    const scoredCandidates = await scoreBuildingsInParallel(
      residentialBuildings,
      listingPhoto.base64,
      listingPhoto.hash,
      listingPhoto.mediaType,
      (scored, total, topScore) => {
        const pct = Math.round((scored / total) * 100);
        updateSearchProgressDetail(searchId, JSON.stringify({
          stage: "verifying_streetview",
          suburb: primaryZone[0].suburb.name,
          scanned: scored,
          total,
          percentage: pct,
          message: `Compared ${scored}/${total} buildings — top score so far: ${topScore}%`,
        }));
        emitProgress(
          "verifying_streetview",
          `Comparing building ${scored} of ${total}...`,
          `Top score: ${topScore}%`,
          45 + Math.round((scored / total) * 50)
        );
      }
    );

    appendPipelineLog(searchId, {
      stage: "facade_matching_complete",
      buildingsScored: scoredCandidates.length,
      topScore: scoredCandidates[0]?.score.score ?? 0,
    });

    // Save all scored buildings for debug display
    const buildingsForDebug = scoredCandidates.map((sc) => ({
      id: sc.building.id,
      center: { latitude: sc.building.center.lat, longitude: sc.building.center.lng },
      address: sc.building.address || null,
      polygon: sc.building.polygon,
      areaMeters2: sc.building.areaMeters2,
      score: sc.score.score,
      reasoning: sc.score.reasoning,
      matchingFeatures: sc.score.matchingFeatures,
      differences: sc.score.differences,
      streetViewImageUrl: sc.streetViewImageUrl,
    }));
    saveBuildingsFound(searchId, buildingsForDebug);

    // Step 7: Save top 20 as candidates in the DB (user can review more via debug page)
    const topCandidates = scoredCandidates.slice(0, 20);
    for (const sc of topCandidates) {
      const score = sc.score.score;
      const confidenceLevel: "high" | "medium" | "low" =
        score >= 70 ? "high" : score >= 45 ? "medium" : "low";

      const featureMatches = [
        ...sc.score.matchingFeatures.map((f) => ({ feature: f, matched: true, source: "street_view", notes: null })),
        ...sc.score.differences.map((d) => ({ feature: d, matched: false, source: "street_view", notes: null })),
      ];

      upsertCandidate({
        searchId,
        address: sc.building.address || `${sc.building.center.lat.toFixed(6)}, ${sc.building.center.lng.toFixed(6)}`,
        latitude: sc.building.center.lat,
        longitude: sc.building.center.lng,
        confidenceScore: score,
        confidenceLevel,
        satelliteMatchScore: 0,
        streetviewMatchScore: score,
        featureMatches: JSON.stringify(featureMatches),
        aiExplanation: sc.score.reasoning,
        streetviewImageUrl: sc.streetViewImageUrl,
        satelliteImageUrl: null,
      });
    }

    // We don't use the old satellite + verification flow anymore — but keep a stub
    // for the old fingerprint variable reference
    const candidates = topCandidates.map((sc) => ({
      id: uuidv4(),
      listingId: searchId,
      address: sc.building.address || `${sc.building.center.lat.toFixed(6)}, ${sc.building.center.lng.toFixed(6)}`,
      latitude: sc.building.center.lat,
      longitude: sc.building.center.lng,
      confidenceScore: sc.score.score,
      confidenceLevel: (sc.score.score >= 70 ? "high" : sc.score.score >= 45 ? "medium" : "low") as "high" | "medium" | "low",
      satelliteMatchScore: 0,
      streetviewMatchScore: sc.score.score,
      featureMatches: [],
      aiExplanation: sc.score.reasoning,
      streetviewImageUrl: sc.streetViewImageUrl,
      satelliteImageUrl: null,
      status: "pending" as const,
      confirmedAt: null,
    }));

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
