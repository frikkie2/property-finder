import type { ListingData, SearchProgress } from "./types";
import {
  getDb,
  getSearch,
  updateSearchStatus,
  updateSearchFingerprint,
  updateSearchProgressDetail,
  appendPipelineLog,
  saveBuildingsFound,
  upsertCandidate,
} from "./db";
import { extractFeaturesFromListing } from "./feature-extractor";
import { listStreetIndexes, matchListingToIndexes, adjudicateStreetMatches, type StreetMatch } from "./street-index";
import { normalizeSuburbName } from "./suburb-data";
import { fetchSatelliteImage } from "./google-maps";

/**
 * Manual photo search: fingerprint the uploaded photos, then match them
 * against the available street indexes (the decoded streets). Falls back with
 * a clear error if no index covers the chosen suburb.
 */
export async function runManualPhotoSearch(searchId: string, listing: ListingData): Promise<void> {
  function emit(status: SearchProgress["status"], message: string, detail: string | null, pct: number) {
    getDb().prepare("UPDATE searches SET status = ? WHERE id = ?").run(status, searchId);
    updateSearchProgressDetail(searchId, JSON.stringify({ stage: status, message, detail, percentage: pct }));
  }

  try {
    appendPipelineLog(searchId, { stage: "manual_upload", suburb: listing.listedSuburb, photos: listing.photoUrls.length });

    // Which street indexes apply? Prefer those in the chosen suburb; else use all.
    const all = listStreetIndexes();
    if (all.length === 0) {
      throw new Error("No streets have been indexed yet. Decode a street first, then upload photos to match against it.");
    }
    const suburbNorm = (listing.listedSuburb || "").toLowerCase();
    const scoped = all.filter((ix) => ix.suburb.toLowerCase() === suburbNorm);
    const indexes = scoped.length ? scoped : all;
    const totalHouses = indexes.reduce((n, ix) => n + ix.houses.length, 0);

    emit("analysing_photos", "Analysing uploaded photos...", null, 12);
    const fingerprint = await extractFeaturesFromListing(listing);
    updateSearchFingerprint(searchId, JSON.stringify(fingerprint));
    appendPipelineLog(searchId, { stage: "fingerprint_extracted", facade: fingerprint.facade?.summary?.slice(0, 120) });

    emit(
      "verifying_streetview",
      `Matching against ${totalHouses} indexed houses on ${indexes.map((i) => i.street).join(", ")}...`,
      null,
      30
    );
    const matches = await matchListingToIndexes(listing, fingerprint, indexes, (done, total) => {
      emit("verifying_streetview", `Compared ${done}/${total} indexed houses`, null, 30 + Math.round((done / total) * 55));
    });

    appendPipelineLog(searchId, { stage: "street_match_complete", compared: matches.length, topScore: matches[0]?.score ?? 0 });

    // Head-to-head adjudication of the top candidates → calibrated ranking.
    emit("ranking_results", "Adjudicating top candidates head-to-head...", null, 88);
    const adjudicated = await adjudicateStreetMatches(matches, listing, fingerprint);
    // Use the adjudicated ranking/scores for the leaders; keep the rest below.
    const adjudicatedKeys = new Set(adjudicated.map((a) => a.house.svKey));
    const ranked = [
      ...adjudicated,
      ...matches.filter((m) => !adjudicatedKeys.has(m.house.svKey)),
    ];
    appendPipelineLog(searchId, { stage: "adjudication_complete", top: ranked[0] ? `${ranked[0].house.address} ${ranked[0].score}%` : null });

    // Debug payload: every compared house (adjudicated leaders first)
    saveBuildingsFound(
      searchId,
      ranked.map((m) => ({
        center: { latitude: m.house.lat, longitude: m.house.lng },
        address: m.house.address,
        score: m.score,
        aerialScore: undefined,
        streetScore: m.score,
        reasoning: m.reasoning,
        matchingFeatures: m.matchingFeatures,
        differences: m.differences,
        streetViewImageUrl: `/api/images/${m.house.svKey}`,
        satelliteImageUrl: null,
      }))
    );

    // Persist top 5 with a satellite close-up for the comparison view.
    getDb().prepare("DELETE FROM candidates WHERE search_id = ?").run(searchId);
    const top = ranked.slice(0, 5);
    for (const m of top) {
      let satKey: string | null = null;
      try {
        satKey = (await fetchSatelliteImage(m.house.lat, m.house.lng, 20, "640x640", 2)).key;
      } catch { /* satellite is display-only */ }
      const level = m.score >= 70 ? "high" : m.score >= 45 ? "medium" : "low";
      // Show BOTH number signals; the satellite/Street View pin is the truth.
      const streetPart = m.house.address.replace(/^\d+[A-Za-z]?\s*/, "");
      const numberLine = m.house.readNumber && m.house.readNumber !== m.house.googleNumber
        ? `Google no. ~${m.house.googleNumber}, number seen on site: ${m.house.readNumber}`
        : `Google no. ~${m.house.googleNumber} (estimate)${m.house.readNumber ? ` · confirmed on site: ${m.house.readNumber}` : ""}`;
      const address = `${streetPart} — ${numberLine}`;
      upsertCandidate({
        searchId,
        address,
        latitude: m.house.lat,
        longitude: m.house.lng,
        confidenceScore: m.score,
        confidenceLevel: level,
        satelliteMatchScore: 0,
        streetviewMatchScore: m.score,
        featureMatches: JSON.stringify([
          ...m.matchingFeatures.map((f) => ({ feature: f, matched: true, source: "street_view", notes: null })),
          ...m.differences.map((d) => ({ feature: d, matched: false, source: "street_view", notes: null })),
        ]),
        aiExplanation: m.reasoning,
        streetviewImageUrl: `/api/images/${m.house.svKey}`,
        satelliteImageUrl: satKey ? `/api/images/${satKey}` : null,
      });
    }

    emit("complete", "Match complete", top[0] ? `Best match: ${top[0].house.address} (${top[0].score}%)` : "No confident match", 100);
    updateSearchStatus(searchId, "complete", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[MANUAL] failed:", message);
    appendPipelineLog(searchId, { stage: "failed", error: message });
    updateSearchStatus(searchId, "failed", message);
  }
}
