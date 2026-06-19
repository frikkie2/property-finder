import type { SearchProgress, SearchResult, Candidate, ListingData } from "./types";
import {
  createSearch,
  getSearch,
  getDb,
  updateSearchStatus,
  updateSearchFingerprint,
  updateSearchListingData,
  updateSearchProgressDetail,
  appendPipelineLog,
  saveBuildingsFound,
  upsertCandidate,
} from "./db";
import { extractListingFromUrl } from "./listing-extractor";
import { extractFeaturesFromListing } from "./feature-extractor";
import { ADJACENCY, normalizeSuburbName, resolveSuburbBounds } from "./suburb-data";
import { sweepSuburb, confirmCandidates } from "./tile-sweep";
import { scoreCandidatesViaStreetView, combinedScore } from "./streetview-compare";
import { adjudicate, tryQuickWin, type FinalCandidate } from "./adjudicator";
import { v4 as uuidv4 } from "uuid";

type ProgressCallback = (progress: SearchProgress) => void;

// How many candidates flow through each funnel stage
const MAX_CONFIRM = 60;   // zoom-20 aerial confirmation
const MAX_STREETVIEW = 25; // street view comparison
const MIN_AERIAL_SCORE = 30;

export async function runSearchPipeline(
  property24Url: string,
  existingSearchId?: string,
  onProgress?: ProgressCallback,
  // When provided (manual photo upload), the listing is used as-is and the
  // Property24 scrape stage is skipped.
  prebuiltListing?: ListingData
): Promise<SearchResult> {
  const searchId = existingSearchId || createSearch(property24Url, "", {});

  function emitProgress(
    status: SearchProgress["status"],
    message: string,
    detail: string | null,
    percentage: number
  ) {
    // NOTE: status only — error_message is written exclusively in the catch
    // block (the old code wiped it here, which is why failures showed blank).
    getDb().prepare("UPDATE searches SET status = ? WHERE id = ?").run(status, searchId);
    updateSearchProgressDetail(searchId, JSON.stringify({ stage: status, message, detail, percentage }));
    onProgress?.({ status, message, detail, percentage });
  }

  try {
    // ---- Stage 1: listing ----
    let listing: ListingData;
    if (prebuiltListing) {
      listing = prebuiltListing;
      emitProgress(
        "extracting_listing",
        "Using uploaded photos",
        `${listing.photoUrls.length} photos, ${listing.listedSuburb}`,
        8
      );
      appendPipelineLog(searchId, {
        stage: "manual_upload",
        suburb: listing.listedSuburb,
        photos: listing.photoUrls.length,
      });
    } else {
      emitProgress("extracting_listing", "Fetching listing from Property24...", null, 4);
      listing = await extractListingFromUrl(property24Url);
      updateSearchListingData(searchId, JSON.stringify(listing));
      getDb().prepare("UPDATE searches SET listed_suburb = ? WHERE id = ?").run(listing.listedSuburb, searchId);
      appendPipelineLog(searchId, {
        stage: "listing_extracted",
        suburb: listing.listedSuburb,
        photos: listing.photoUrls.length,
        erf: listing.plotSize,
      });
      emitProgress(
        "extracting_listing",
        "Listing extracted",
        `${listing.photoUrls.length} photos, ${listing.bedrooms ?? "?"} bed, erf ${listing.plotSize ?? "?"} m², ${listing.listedSuburb}`,
        8
      );
    }
    if (listing.photoUrls.length === 0) {
      throw new Error("No photos provided — cannot identify a property without photos.");
    }

    // ---- Stage 2: fingerprint ----
    emitProgress("analysing_photos", "Analysing photos with AI...", null, 12);
    const fingerprint = await extractFeaturesFromListing(listing);
    updateSearchFingerprint(searchId, JSON.stringify(fingerprint));
    appendPipelineLog(searchId, { stage: "fingerprint_extracted", quickWins: fingerprint.quickWins.length });
    emitProgress(
      "analysing_photos",
      "Fingerprint built",
      fingerprint.aerial?.summary?.slice(0, 140) ?? null,
      20
    );

    // ---- Stage 3: quick win (house number + street OCR'd from photos) ----
    if (fingerprint.houseNumber && fingerprint.streetClue) {
      emitProgress("analysing_photos", `Quick win: trying "${fingerprint.houseNumber} ${fingerprint.streetClue}"...`, null, 24);
      const quickWin = await tryQuickWin(fingerprint, listing);
      if (quickWin) {
        appendPipelineLog(searchId, { stage: "quick_win_confirmed", address: quickWin.address });
        const candidates = persistFinalCandidates(searchId, [quickWin]);
        emitProgress("complete", "Identified via house number in photos", quickWin.address, 100);
        updateSearchStatus(searchId, "complete", null);
        return buildResult(searchId, listing, fingerprint, candidates);
      }
    }

    // ---- Stage 4: suburb bounds ----
    const suburbName = normalizeSuburbName(listing.listedSuburb);
    if (!suburbName) {
      throw new Error(
        `Listing suburb "${listing.listedSuburb}" is not in the configured suburb list.`
      );
    }
    emitProgress("narrowing_suburbs", `Resolving boundary for ${suburbName}...`, null, 26);
    const bounds = await resolveSuburbBounds(suburbName);
    appendPipelineLog(searchId, { stage: "suburb_resolved", suburbName, bounds });

    // ---- Stage 5: satellite sweep ----
    if (!fingerprint.aerial) {
      throw new Error("Fingerprint extraction did not produce an aerial signature.");
    }
    emitProgress("scanning_satellite", `Sweeping ${suburbName} satellite imagery...`, null, 30);
    const sweep = await sweepSuburb(bounds, fingerprint.aerial, (done, total) => {
      emitProgress(
        "scanning_satellite",
        `Sweeping satellite tiles: ${done}/${total}`,
        null,
        30 + Math.round((done / total) * 28)
      );
    });
    appendPipelineLog(searchId, {
      stage: "sweep_complete",
      tiles: sweep.tilesScanned,
      candidates: sweep.candidates.length,
    });
    if (sweep.candidates.length === 0) {
      throw new Error(
        `Satellite sweep of ${suburbName} found no stands matching the listing. ` +
        `The property may be in an adjacent suburb, or the aerial signature may be too strict.`
      );
    }

    // ---- Stage 6: aerial close-up confirmation ----
    const toConfirm = sweep.candidates.slice(0, MAX_CONFIRM);
    emitProgress("scanning_satellite", `Confirming ${toConfirm.length} candidates with close-ups...`, null, 58);
    const confirmed = await confirmCandidates(toConfirm, fingerprint.aerial, (done, total) => {
      emitProgress("scanning_satellite", `Close-up check ${done}/${total}`, null, 58 + Math.round((done / total) * 14));
    });
    appendPipelineLog(searchId, {
      stage: "confirm_complete",
      confirmed: confirmed.length,
      topScore: confirmed[0]?.aerialScore ?? 0,
    });

    // ---- Stage 7: Street View comparison ----
    const svPool = confirmed.filter((c) => c.aerialScore >= MIN_AERIAL_SCORE).slice(0, MAX_STREETVIEW);
    const svInput = svPool.length >= 5 ? svPool : confirmed.slice(0, Math.min(10, confirmed.length));
    emitProgress("verifying_streetview", `Comparing ${svInput.length} candidates via Street View...`, null, 74);
    const svScored = await scoreCandidatesViaStreetView(
      svInput,
      fingerprint,
      listing.photoUrls,
      (done, total) => {
        emitProgress("verifying_streetview", `Street View comparison ${done}/${total}`, null, 74 + Math.round((done / total) * 14));
      }
    );
    appendPipelineLog(searchId, {
      stage: "streetview_complete",
      scored: svScored.length,
      topStreetScore: svScored[0]?.streetScore ?? 0,
    });

    // Save every scored candidate for the debug page
    saveBuildingsFound(
      searchId,
      svScored.map((c) => ({
        center: { latitude: c.lat, longitude: c.lng },
        address: null,
        score: Math.round(combinedScore(c)),
        aerialScore: c.aerialScore,
        streetScore: c.streetScore,
        reasoning: `${c.aerialReasoning} | ${c.streetReasoning}`,
        matchingFeatures: c.matchingFeatures,
        differences: c.differences,
        streetViewImageUrl: c.streetViewKey ? `/api/images/${c.streetViewKey}` : null,
        satelliteImageUrl: `/api/images/${c.closeupKey}`,
      }))
    );

    // ---- Stage 8: final adjudication ----
    emitProgress("ranking_results", "Final adjudication of top candidates...", null, 90);
    const finals = await adjudicate(svScored, listing, fingerprint);
    appendPipelineLog(searchId, {
      stage: "adjudication_complete",
      finalists: finals.length,
      top: finals[0] ? { address: finals[0].address, confidence: finals[0].confidence } : null,
    });

    const candidates = persistFinalCandidates(searchId, finals);

    emitProgress(
      "complete",
      "Search complete",
      finals[0] ? `Best match: ${finals[0].address} (${finals[0].confidence}%)` : "No confident match",
      100
    );
    updateSearchStatus(searchId, "complete", null);
    return buildResult(searchId, listing, fingerprint, candidates);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PIPELINE] FAILED:", message, error);
    onProgress?.({ status: "failed", message: "Search failed", detail: message, percentage: 0 });
    // Written LAST so nothing overwrites the error message
    updateSearchStatus(searchId, "failed", message);
    appendPipelineLog(searchId, { stage: "failed", error: message });

    return {
      id: searchId,
      listing: {} as SearchResult["listing"],
      fingerprint: null,
      candidates: [],
      status: "failed",
      errorMessage: message,
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Expand an existing (completed) search into the suburbs adjacent to the
 * listed one, re-running the sweep → confirm → street view → adjudicate
 * funnel over the combined candidate set.
 */
export async function expandSearchToAdjacent(searchId: string): Promise<{ suburbs: string[] }> {
  const search = getSearch(searchId);
  if (!search) throw new Error("Search not found");

  const listing = JSON.parse(search.listing_data || "{}") as SearchResult["listing"];
  const fingerprint = JSON.parse(search.fingerprint || "null") as SearchResult["fingerprint"];
  if (!fingerprint?.aerial) throw new Error("Search has no fingerprint to expand with");

  const home = normalizeSuburbName(listing.listedSuburb || "");
  const adjacent = home ? ADJACENCY[home] ?? [] : [];
  if (adjacent.length === 0) throw new Error("No adjacent suburbs configured");

  (async () => {
    try {
      updateSearchStatus(searchId, "scanning_satellite", null);
      const allCandidates = [];
      for (const name of adjacent) {
        const bounds = await resolveSuburbBounds(name);
        const sweep = await sweepSuburb(bounds, fingerprint.aerial!);
        allCandidates.push(...sweep.candidates);
        appendPipelineLog(searchId, { stage: "expand_sweep", suburb: name, found: sweep.candidates.length });
      }
      const confirmed = await confirmCandidates(allCandidates.slice(0, MAX_CONFIRM), fingerprint.aerial!);
      updateSearchStatus(searchId, "verifying_streetview", null);
      const svScored = await scoreCandidatesViaStreetView(
        confirmed.filter((c) => c.aerialScore >= MIN_AERIAL_SCORE).slice(0, MAX_STREETVIEW),
        fingerprint,
        listing.photoUrls ?? []
      );
      updateSearchStatus(searchId, "ranking_results", null);
      const finals = await adjudicate(svScored, listing, fingerprint);
      // Append after the existing finalists rather than replacing them
      for (const f of finals) f.verdict = `[adjacent suburb] ${f.verdict}`;
      for (const f of finals) {
        const confidenceLevel = f.confidence >= 70 ? "high" : f.confidence >= 40 ? "medium" : "low";
        upsertCandidate({
          searchId,
          address: f.address,
          latitude: f.lat,
          longitude: f.lng,
          confidenceScore: f.confidence,
          confidenceLevel,
          satelliteMatchScore: f.confidence,
          streetviewMatchScore: f.confidence,
          featureMatches: "[]",
          aiExplanation: f.verdict,
          streetviewImageUrl: f.streetViewKey ? `/api/images/${f.streetViewKey}` : null,
          satelliteImageUrl: f.satelliteKey ? `/api/images/${f.satelliteKey}` : null,
        });
      }
      updateSearchStatus(searchId, "complete", null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[EXPAND] failed:", message);
      appendPipelineLog(searchId, { stage: "expand_failed", error: message });
      updateSearchStatus(searchId, "complete", null); // keep original results usable
    }
  })();

  return { suburbs: adjacent };
}

function persistFinalCandidates(searchId: string, finals: FinalCandidate[]): Candidate[] {
  // Re-runs (expand / retry) shouldn't stack duplicates
  getDb().prepare("DELETE FROM candidates WHERE search_id = ?").run(searchId);

  const candidates: Candidate[] = [];
  for (const f of finals) {
    const confidenceLevel = f.confidence >= 70 ? "high" : f.confidence >= 40 ? "medium" : "low";
    const featureMatches = [
      ...f.matchingFeatures.map((m) => ({ feature: m, matched: true, source: "both" as const, notes: null })),
      ...f.differences.map((d) => ({ feature: d, matched: false, source: "both" as const, notes: null })),
    ];
    upsertCandidate({
      searchId,
      address: f.address,
      latitude: f.lat,
      longitude: f.lng,
      confidenceScore: f.confidence,
      confidenceLevel,
      satelliteMatchScore: f.confidence,
      streetviewMatchScore: f.confidence,
      featureMatches: JSON.stringify(featureMatches),
      aiExplanation: f.verdict,
      streetviewImageUrl: f.streetViewKey ? `/api/images/${f.streetViewKey}` : null,
      satelliteImageUrl: f.satelliteKey ? `/api/images/${f.satelliteKey}` : null,
    });
    candidates.push({
      id: uuidv4(),
      listingId: searchId,
      address: f.address,
      latitude: f.lat,
      longitude: f.lng,
      confidenceScore: f.confidence,
      confidenceLevel,
      satelliteMatchScore: f.confidence,
      streetviewMatchScore: f.confidence,
      featureMatches,
      aiExplanation: f.verdict,
      streetviewImageUrl: f.streetViewKey ? `/api/images/${f.streetViewKey}` : null,
      satelliteImageUrl: f.satelliteKey ? `/api/images/${f.satelliteKey}` : null,
      status: "pending",
      confirmedAt: null,
    });
  }
  return candidates;
}

function buildResult(
  searchId: string,
  listing: SearchResult["listing"],
  fingerprint: SearchResult["fingerprint"],
  candidates: Candidate[]
): SearchResult {
  const row = getSearch(searchId);
  return {
    id: searchId,
    listing,
    fingerprint,
    candidates,
    status: "complete",
    errorMessage: null,
    createdAt: row?.created_at ?? new Date().toISOString(),
  };
}
