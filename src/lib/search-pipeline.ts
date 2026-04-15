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
import { scanSuburbZones } from "./satellite-scanner";
import { scanSuburbWithSolarApi } from "./solar-scanner";
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

    // Step 4a: Try Google Solar API first (fast, building-level data)
    let satelliteMatches: Awaited<ReturnType<typeof scanSuburbZones>> = [];

    if (primaryZone.length > 0) {
      emitProgress("scanning_satellite", `Querying Google Solar API for ${primaryZone[0].suburb.name}...`, null, 40);
      console.log("[PIPELINE] Trying Solar API first...");
      appendPipelineLog(searchId, { stage: "solar_start", suburb: primaryZone[0].suburb.name });

      try {
        const solarResult = await scanSuburbWithSolarApi(
          primaryZone[0].suburb,
          fingerprint,
          (sampled, total, found) => {
            const pct = Math.round((sampled / total) * 100);
            updateSearchProgressDetail(searchId, JSON.stringify({
              stage: "scanning_satellite",
              suburb: `${primaryZone[0].suburb.name} (Solar API)`,
              scanned: sampled,
              total,
              percentage: pct,
              message: `Solar API: ${sampled}/${total} points sampled, ${found} buildings found`
            }));
            emitProgress("scanning_satellite", `Solar API scan...`, `${sampled}/${total} points, ${found} buildings`, 40 + Math.round((sampled / total) * 35));
          }
        );

        satelliteMatches = solarResult.matches;

        // Save all scored buildings (including low scores) for debug display
        const buildingsForDebug = solarResult.allScored.map((sc) => ({
          name: sc.building.name,
          center: sc.building.center,
          boundingBox: sc.building.boundingBox,
          roofSegments: sc.building.solarPotential?.roofSegmentStats?.map((s) => ({
            center: s.center,
            boundingBox: s.boundingBox,
            areaMeters2: s.stats.areaMeters2,
            pitchDegrees: s.pitchDegrees,
            azimuthDegrees: s.azimuthDegrees,
          })) || [],
          totalRoofArea: sc.building.solarPotential?.wholeRoofStats?.areaMeters2 ?? 0,
          hasSolarPanels: (sc.building.solarPotential?.solarPanels?.length ?? 0) > 0,
          score: sc.score,
          confidence: sc.confidence,
          reasons: sc.reasons,
        }));
        saveBuildingsFound(searchId, buildingsForDebug);

        appendPipelineLog(searchId, {
          stage: "solar_complete",
          buildingsFound: solarResult.buildings.length,
          matchesReturned: satelliteMatches.length,
          topScore: solarResult.allScored[0]?.score ?? 0,
        });

        console.log(`[PIPELINE] Solar API found ${satelliteMatches.length} candidates (${solarResult.buildings.length} buildings total)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendPipelineLog(searchId, { stage: "solar_failed", error: msg });
        console.warn("[PIPELINE] Solar API failed, falling back to tile scan:", err);
      }
    }

    // Step 4b: Fall back to tile scan if Solar API returned nothing or too few
    if (satelliteMatches.length < 3) {
      console.log(`[PIPELINE] Solar API insufficient (${satelliteMatches.length}), running tile scan fallback`);
      emitProgress("scanning_satellite", `Running detailed tile scan...`, null, 60);

      const tileMatches = await scanSuburbZones(
        primaryZone,
        fingerprint,
        (scanned, total, suburb) => {
          const pct = Math.round((scanned / total) * 100);
          updateSearchProgressDetail(searchId, JSON.stringify({
            stage: "scanning_satellite",
            suburb,
            scanned,
            total,
            percentage: pct,
            message: `Scanning ${suburb}: tile ${scanned} of ${total} (${pct}%)`
          }));
          emitProgress("scanning_satellite", `Scanning ${suburb}...`, `Tile ${scanned} of ${total}`, 60 + Math.round((scanned / total) * 15));
        }
      );

      // Combine Solar API matches with tile matches
      satelliteMatches.push(...tileMatches);
    }

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
