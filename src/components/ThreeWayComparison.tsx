"use client";

import Image from "next/image";
import type { Candidate, ListingData } from "@/lib/types";
import FeatureMatchGrid from "./FeatureMatchGrid";

interface Props {
  candidate: Candidate;
  listing: ListingData;
  onConfirm: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
}

function ImagePanel({
  src,
  alt,
  label,
  borderClass,
}: {
  src: string | null;
  alt: string;
  label: string;
  borderClass: string;
}) {
  return (
    <div className={`flex flex-col gap-1 flex-1`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <div className={`relative aspect-video w-full rounded-lg overflow-hidden border-4 ${borderClass} bg-gray-100`}>
        {src ? (
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Not available
          </div>
        )}
      </div>
    </div>
  );
}

export default function ThreeWayComparison({ candidate, listing, onConfirm, onReject }: Props) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${candidate.latitude},${candidate.longitude}`;
  const firstPhoto = listing.photoUrls?.[0] ?? null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{candidate.address}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Confidence: {Math.round(candidate.confidenceScore * 100)}%
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            candidate.confidenceLevel === "high"
              ? "bg-green-100 text-green-800"
              : candidate.confidenceLevel === "medium"
              ? "bg-yellow-100 text-yellow-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {candidate.confidenceLevel}
        </span>
      </div>

      {/* Three-way image comparison */}
      <div className="flex flex-col md:flex-row gap-4">
        <ImagePanel
          src={firstPhoto}
          alt="Listing photo"
          label="Listing photo"
          borderClass="border-blue-700"
        />
        <ImagePanel
          src={candidate.streetviewImageUrl}
          alt="Street view"
          label="Street view"
          borderClass="border-yellow-400"
        />
        <ImagePanel
          src={candidate.satelliteImageUrl}
          alt="Satellite"
          label="Satellite"
          borderClass="border-green-500"
        />
      </div>

      {/* AI explanation */}
      {candidate.aiExplanation && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-1">
            AI notes
          </p>
          <p className="text-sm text-gray-800">{candidate.aiExplanation}</p>
        </div>
      )}

      {/* Feature matches */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Feature matches
        </p>
        <FeatureMatchGrid featureMatches={candidate.featureMatches} />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 pt-1">
        <button
          onClick={() => onConfirm(candidate.id)}
          className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
        >
          Confirm match
        </button>
        <button
          onClick={() => onReject(candidate.id)}
          className="rounded-lg bg-red-500 px-5 py-2 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
        >
          Not a match
        </button>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Open in Maps
        </a>
      </div>
    </div>
  );
}
