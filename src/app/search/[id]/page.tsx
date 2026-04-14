"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type { Candidate, ListingData, SearchStatus } from "@/lib/types";
import ProgressTracker from "@/components/ProgressTracker";
import ThreeWayComparison from "@/components/ThreeWayComparison";
import CandidateCard from "@/components/CandidateCard";
import PhotoStrip from "@/components/PhotoStrip";
import MapView from "@/components/MapView";

interface SearchResponse {
  id: string;
  property24Url: string;
  listedSuburb: string | null;
  listing: ListingData | null;
  candidates: Candidate[];
  status: SearchStatus;
  errorMessage: string | null;
  createdAt: string;
}

const IN_PROGRESS_STATUSES: SearchStatus[] = [
  "extracting_listing",
  "analysing_photos",
  "narrowing_suburbs",
  "scanning_satellite",
  "verifying_streetview",
  "ranking_results",
];

const POLL_INTERVAL_MS = 3000;

export default function SearchPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<number>(0);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/search/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to load search.");
        return;
      }
      const json: SearchResponse = await res.json();
      setData(json);
    } catch {
      setError("Network error. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial fetch + polling for in-progress
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!data) return;
    if (!IN_PROGRESS_STATUSES.includes(data.status)) return;
    const timer = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [data, fetchData]);

  async function handleConfirm(candidateId: string) {
    await fetch(`/api/candidate/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    fetchData();
  }

  async function handleReject(candidateId: string) {
    await fetch(`/api/candidate/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected" }),
    });
    fetchData();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error ?? "Search not found."}
      </div>
    );
  }

  const isInProgress = IN_PROGRESS_STATUSES.includes(data.status);
  const isFailed = data.status === "failed";
  const isComplete = data.status === "complete";

  // Active candidates (not rejected)
  const activeCandidates = data.candidates.filter((c) => c.status !== "rejected");
  const currentCandidate = activeCandidates[selectedCandidate] ?? activeCandidates[0];

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb / header */}
      <div>
        <a href="/" className="text-xs text-blue-700 hover:underline">
          &larr; Back to dashboard
        </a>
        <h1 className="text-base font-semibold text-gray-900 mt-1 break-all">
          {data.property24Url}
        </h1>
        {data.listedSuburb && (
          <p className="text-xs text-gray-500 mt-0.5">Listed suburb: {data.listedSuburb}</p>
        )}
      </div>

      {/* In-progress state */}
      {isInProgress && (
        <ProgressTracker
          status={data.status}
          message="Analysing the listing and searching for a match. This may take up to a minute."
        />
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <ProgressTracker status={data.status} />
          {data.errorMessage && (
            <p className="mt-3 text-sm text-red-700">{data.errorMessage}</p>
          )}
        </div>
      )}

      {/* Complete state */}
      {isComplete && data.listing && (
        <>
          {/* Listing photo strip */}
          {data.listing.photoUrls?.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Listing photos
              </p>
              <PhotoStrip photoUrls={data.listing.photoUrls} />
            </section>
          )}

          {/* No candidates */}
          {activeCandidates.length === 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-800">
              No matching candidates were found for this listing.
            </div>
          )}

          {/* Candidate selector when multiple */}
          {activeCandidates.length > 1 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Candidates ({activeCandidates.length})
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {activeCandidates.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCandidate(i)}
                    className={`text-left transition-all rounded-lg ${
                      i === selectedCandidate ? "ring-2 ring-blue-700" : ""
                    }`}
                  >
                    <CandidateCard candidate={c} rank={i + 1} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Three-way comparison for selected candidate */}
          {currentCandidate && (
            <ThreeWayComparison
              candidate={currentCandidate}
              listing={data.listing}
              onConfirm={handleConfirm}
              onReject={handleReject}
            />
          )}

          {/* Drive-by map */}
          {activeCandidates.length > 0 && (
            <MapView
              candidates={activeCandidates.map((c) => ({
                address: c.address,
                lat: c.latitude,
                lng: c.longitude,
              }))}
            />
          )}
        </>
      )}
    </div>
  );
}
