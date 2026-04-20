"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface PipelineEvent {
  stage: string;
  timestamp: string;
  [key: string]: unknown;
}

interface BuildingData {
  id: number;
  center: { latitude: number; longitude: number };
  address: string | null;
  polygon: { lat: number; lng: number }[];
  areaMeters2: number;
  score: number;
  reasoning: string;
  matchingFeatures: string[];
  differences: string[];
  streetViewImageUrl: string;
}

export default function DebugPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<any>(null);
  const [buildingFilter, setBuildingFilter] = useState<"all" | "top">("top");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/search/${id}`)
      .then((r) => r.json())
      .then((json) => setData(json));
  }, [id]);

  if (!data) return <p className="p-5">Loading diagnostic data...</p>;

  const listing = data.listing || {};
  const fingerprint = data.fingerprint || {};
  const pipelineLog: PipelineEvent[] = data.pipelineLog || [];
  const buildings: BuildingData[] = data.buildingsFound || [];
  const displayBuildings = buildingFilter === "top" ? buildings.slice(0, 30) : buildings;

  const frontIdx = fingerprint.bestFrontOfHousePhotoIndex;
  const frontPhotoUrl = frontIdx && frontIdx > 0 && listing.photoUrls ? listing.photoUrls[frontIdx - 1] : listing.photoUrls?.[0];

  return (
    <div className="max-w-6xl mx-auto p-5 space-y-6">
      <div>
        <a href={`/search/${id}`} className="text-xs text-blue-700 hover:underline">
          &larr; Back to search results
        </a>
        <h1 className="text-lg font-bold mt-2">Pipeline Diagnostic</h1>
        <p className="text-xs text-gray-500">
          Status: <span className="font-mono">{data.status}</span>
          {data.errorMessage && <span className="ml-2 text-red-600">— {data.errorMessage}</span>}
        </p>
      </div>

      {/* Pipeline timeline */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-3">Pipeline Timeline</h2>
        {pipelineLog.length === 0 ? (
          <p className="text-xs text-gray-400">No pipeline events logged yet.</p>
        ) : (
          <ol className="space-y-2 text-xs">
            {pipelineLog.map((ev, i) => (
              <li key={i} className="border-l-2 border-blue-200 pl-3">
                <div className="font-mono text-gray-500">
                  {new Date(ev.timestamp).toLocaleTimeString()} — <span className="font-semibold text-blue-700">{ev.stage}</span>
                </div>
                <pre className="mt-1 bg-gray-50 p-2 rounded text-[11px] overflow-x-auto">
                  {JSON.stringify(Object.fromEntries(Object.entries(ev).filter(([k]) => k !== "timestamp" && k !== "stage")), null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Front-of-house photo being compared */}
      {frontPhotoUrl && (
        <section className="rounded-lg border border-blue-300 bg-blue-50 p-4">
          <h2 className="font-bold mb-2">Reference Photo (being compared to each building)</h2>
          <p className="text-xs text-gray-600 mb-3">
            Photo #{frontIdx || 1} — identified as the best front-of-house shot.
          </p>
          <div className="max-w-md">
            <img
              src={`/api/proxy-image?url=${encodeURIComponent(frontPhotoUrl)}`}
              alt="Reference"
              className="rounded border border-gray-300"
            />
          </div>
        </section>
      )}

      {/* All listing photos for reference */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-3">All Listing Photos ({listing.photoUrls?.length || 0})</h2>
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {(listing.photoUrls || []).map((url: string, i: number) => (
            <div key={i} className={`relative aspect-video rounded overflow-hidden border-2 ${i + 1 === frontIdx ? "border-blue-600" : "border-gray-200"}`}>
              <img
                src={`/api/proxy-image?url=${encodeURIComponent(url)}`}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
              />
              <span className="absolute top-1 left-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded">
                #{i + 1}
              </span>
              {i + 1 === frontIdx && (
                <span className="absolute bottom-1 right-1 bg-blue-600 text-white text-[9px] px-1 py-0.5 rounded">
                  FRONT
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Fingerprint */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-3">AI Fingerprint</h2>
        {!fingerprint || Object.keys(fingerprint).length === 0 ? (
          <p className="text-xs text-gray-400">No fingerprint extracted.</p>
        ) : (
          <pre className="bg-gray-50 rounded p-3 text-[11px] overflow-x-auto">
            {JSON.stringify(fingerprint, null, 2)}
          </pre>
        )}
      </section>

      {/* Side-by-side building comparisons */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold">
            All Buildings Considered ({buildings.length}) — Side-by-Side Comparisons
          </h2>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setBuildingFilter("top")}
              className={`px-2 py-1 rounded ${buildingFilter === "top" ? "bg-blue-700 text-white" : "bg-gray-100"}`}
            >
              Top 30
            </button>
            <button
              onClick={() => setBuildingFilter("all")}
              className={`px-2 py-1 rounded ${buildingFilter === "all" ? "bg-blue-700 text-white" : "bg-gray-100"}`}
            >
              All {buildings.length}
            </button>
          </div>
        </div>

        {buildings.length === 0 ? (
          <p className="text-xs text-gray-400">No buildings compared yet.</p>
        ) : (
          <div className="space-y-4">
            {displayBuildings.map((b, i) => (
              <div key={b.id || i} className="border border-gray-200 rounded p-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-sm">
                      #{i + 1} · {b.address || `${b.center.latitude.toFixed(6)}, ${b.center.longitude.toFixed(6)}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {Math.round(b.areaMeters2)}m² footprint
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-bold ${
                      b.score >= 70
                        ? "bg-green-100 text-green-800"
                        : b.score >= 45
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {b.score}%
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase mb-1">Listing</div>
                    <img
                      src={`/api/proxy-image?url=${encodeURIComponent(frontPhotoUrl || "")}`}
                      alt="Listing"
                      className="w-full aspect-video object-cover rounded border border-blue-300"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase mb-1">Street View</div>
                    <img
                      src={b.streetViewImageUrl}
                      alt="Street View"
                      className="w-full aspect-video object-cover rounded border border-yellow-300"
                    />
                  </div>
                </div>

                <p className="text-xs text-gray-700 mt-2 italic">"{b.reasoning}"</p>

                {(b.matchingFeatures.length > 0 || b.differences.length > 0) && (
                  <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
                    {b.matchingFeatures.length > 0 && (
                      <div>
                        <p className="font-semibold text-green-700 text-[10px] uppercase">Matches</p>
                        <ul className="text-green-800 space-y-0.5">
                          {b.matchingFeatures.map((f, j) => (
                            <li key={j}>✓ {f}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {b.differences.length > 0 && (
                      <div>
                        <p className="font-semibold text-red-700 text-[10px] uppercase">Differences</p>
                        <ul className="text-red-800 space-y-0.5">
                          {b.differences.map((d, j) => (
                            <li key={j}>✗ {d}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3 mt-2 text-xs">
                  <a
                    href={`https://www.google.com/maps?q=${b.center.latitude},${b.center.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-700 hover:underline"
                  >
                    Map &#8599;
                  </a>
                  <a
                    href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${b.center.latitude},${b.center.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-700 hover:underline"
                  >
                    Street View &#8599;
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Raw data */}
      <details className="rounded-lg border border-gray-200 bg-white p-4">
        <summary className="font-bold cursor-pointer text-xs">Raw search data</summary>
        <pre className="bg-gray-50 rounded p-3 text-[11px] overflow-x-auto mt-3">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
