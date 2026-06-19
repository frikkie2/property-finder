"use client";

import { useState } from "react";
import Image from "next/image";
import type { Candidate, ListingData } from "@/lib/types";
import FeatureMatchGrid from "./FeatureMatchGrid";
import Lightbox from "./Lightbox";

interface Props {
  candidate: Candidate;
  listing: ListingData;
  onConfirm: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
}

function Panel({
  src,
  label,
  accent,
  onEnlarge,
}: {
  src: string | null;
  label: string;
  accent: string;
  onEnlarge: (src: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
      <span className="data-label flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        {label}
      </span>
      <div
        className={`relative aspect-[4/3] w-full rounded-lg overflow-hidden border border-line bg-paper ${src ? "cursor-zoom-in" : ""}`}
        onClick={() => src && onEnlarge(src)}
      >
        {src ? (
          <Image src={src} alt={label} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">Not available</div>
        )}
      </div>
    </div>
  );
}

export default function ThreeWayComparison({ candidate, listing, onConfirm, onReject }: Props) {
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [listingIdx, setListingIdx] = useState(0);
  const { latitude, longitude } = candidate;
  const streetViewUrl = `https://www.google.com/maps?q=&layer=c&cbll=${latitude},${longitude}`;
  const satelliteUrl = `https://www.google.com/maps/@${latitude},${longitude},80m/data=!3m1!1e3`;

  const photos = listing.photoUrls ?? [];
  const proxy = (u: string) => `/api/proxy-image?url=${encodeURIComponent(u)}`;
  const listingSrc = photos[listingIdx] ? proxy(photos[listingIdx]) : null;
  const confirmed = candidate.status === "confirmed";

  const levelChip =
    candidate.confidenceLevel === "high" ? "bg-forest text-card"
    : candidate.confidenceLevel === "medium" ? "bg-amber text-card"
    : "bg-line text-muted";

  return (
    <div className={`rounded-xl border bg-card p-5 flex flex-col gap-5 ${confirmed ? "border-forest ring-1 ring-forest/30" : "border-line"}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="data-label">{confirmed ? "Confirmed address" : "Top candidate"}</p>
          <h2 className="font-mono text-[15px] text-ink mt-0.5 break-words leading-snug">{candidate.address}</h2>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-display text-2xl text-ink leading-none">{candidate.confidenceScore}%</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${levelChip}`}>
            {candidate.confidenceLevel}
          </span>
        </div>
      </div>

      {/* Three-way comparison */}
      <div className="flex flex-col md:flex-row gap-3">
        <Panel src={listingSrc} label="Listing photo" accent="#a8442a" onEnlarge={setEnlarged} />
        <Panel src={candidate.streetviewImageUrl} label="Street View" accent="#b8791f" onEnlarge={setEnlarged} />
        <Panel src={candidate.satelliteImageUrl} label="Satellite" accent="#2f6b4f" onEnlarge={setEnlarged} />
      </div>

      {/* Listing photo switcher — flip which listing photo you compare against */}
      {photos.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="data-label shrink-0">Listing&nbsp;photo {listingIdx + 1}/{photos.length}</span>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {photos.map((u, i) => (
              <button
                key={i}
                onClick={() => setListingIdx(i)}
                className={`relative h-11 w-14 shrink-0 rounded overflow-hidden border-2 transition ${i === listingIdx ? "border-clay" : "border-transparent opacity-70 hover:opacity-100"}`}
                aria-label={`Listing photo ${i + 1}`}
              >
                <Image src={proxy(u)} alt="" fill sizes="56px" className="object-cover" unoptimized />
              </button>
            ))}
          </div>
        </div>
      )}

      <Lightbox src={enlarged} onClose={() => setEnlarged(null)} />

      {/* AI verdict */}
      {candidate.aiExplanation && (
        <div className="rounded-lg bg-paper border border-line px-4 py-3">
          <p className="data-label mb-1">Why this match</p>
          <p className="text-sm text-ink/90 leading-relaxed">{candidate.aiExplanation}</p>
        </div>
      )}

      {/* Feature matches */}
      {candidate.featureMatches?.length > 0 && (
        <div>
          <p className="data-label mb-2">Feature check</p>
          <FeatureMatchGrid featureMatches={candidate.featureMatches} />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2.5 pt-1 border-t border-line/70 mt-1">
        {confirmed ? (
          <span className="inline-flex items-center gap-2 rounded-lg bg-forest px-4 py-2 text-sm font-semibold text-card">
            ✓ Confirmed match
          </span>
        ) : (
          <button
            onClick={() => onConfirm(candidate.id)}
            className="rounded-lg bg-forest px-5 py-2 text-sm font-semibold text-card hover:brightness-110 transition"
          >
            Confirm this is the property
          </button>
        )}
        <button
          onClick={() => onReject(candidate.id)}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted hover:text-clay hover:border-clay/50 transition"
        >
          {confirmed ? "Undo" : "Not a match"}
        </button>
        <span className="flex-1" />
        <a href={streetViewUrl} target="_blank" rel="noopener noreferrer"
          className="rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-ink hover:border-amber hover:text-amber transition">
          Street View ↗
        </a>
        <a href={satelliteUrl} target="_blank" rel="noopener noreferrer"
          className="rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-ink hover:border-forest hover:text-forest transition">
          Satellite ↗
        </a>
      </div>
    </div>
  );
}
