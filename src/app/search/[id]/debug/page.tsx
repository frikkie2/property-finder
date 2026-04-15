"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import RoofSketch from "@/components/RoofSketch";

interface PipelineEvent {
  stage: string;
  timestamp: string;
  [key: string]: unknown;
}

interface BuildingData {
  name: string;
  center: { latitude: number; longitude: number };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  roofSegments: Array<{
    center: { latitude: number; longitude: number };
    boundingBox: {
      sw: { latitude: number; longitude: number };
      ne: { latitude: number; longitude: number };
    };
    areaMeters2: number;
    pitchDegrees: number;
    azimuthDegrees: number;
  }>;
  totalRoofArea: number;
  hasSolarPanels: boolean;
  score: number;
  confidence: string;
  reasons: string[];
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
  const candidates = data.candidates || [];
  const pipelineLog: PipelineEvent[] = data.pipelineLog || [];
  const buildings: BuildingData[] = data.buildingsFound || [];
  const displayBuildings = buildingFilter === "top" ? buildings.slice(0, 20) : buildings;

  return (
    <div className="max-w-5xl mx-auto p-5 space-y-6">
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

      {/* Listing + photos */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-3">Input: Listing Photos ({listing.photoUrls?.length || 0})</h2>
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {(listing.photoUrls || []).map((url: string, i: number) => (
            <div key={i} className="relative aspect-video rounded overflow-hidden border border-gray-200">
              <img
                src={`/api/proxy-image?url=${encodeURIComponent(url)}`}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
              />
              <span className="absolute top-1 left-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded">
                #{i + 1}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Fingerprint */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-3">AI Fingerprint (what we're looking for)</h2>
        {!fingerprint || Object.keys(fingerprint).length === 0 ? (
          <p className="text-xs text-gray-400">No fingerprint extracted.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            {Object.entries(fingerprint).map(([key, value]) => {
              const displayValue = Array.isArray(value) || typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : String(value);
              return (
                <div key={key} className="bg-gray-50 rounded p-2">
                  <div className="text-gray-500 text-[10px] uppercase">{key}</div>
                  <div className="font-mono text-gray-800 mt-0.5">{displayValue}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Solar API buildings — ROOF SKETCHES */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold">
            Buildings from Solar API ({buildings.length}) — Roof Outline Sketches
          </h2>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setBuildingFilter("top")}
              className={`px-2 py-1 rounded ${buildingFilter === "top" ? "bg-blue-700 text-white" : "bg-gray-100"}`}
            >
              Top 20
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
          <p className="text-xs text-gray-400">
            No buildings returned by Solar API. This suburb may not have coverage.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Each box is a roof outline traced from Google Solar API data.
              Colour indicates facing direction (blue=north, green=east, amber=south, purple=west).
              Red dot = building centre. Score is how well the roof shape matches the fingerprint.
            </p>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
              {displayBuildings.map((b, i) => (
                <div key={b.name || i} className="flex flex-col">
                  <RoofSketch building={b} size={120} />
                  <div className="mt-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="font-bold">{b.score}%</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          b.confidence === "high"
                            ? "bg-green-100 text-green-800"
                            : b.confidence === "medium"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {b.confidence}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {b.center.latitude.toFixed(4)}, {b.center.longitude.toFixed(4)}
                    </div>
                    {b.hasSolarPanels && (
                      <div className="text-[10px] text-yellow-700 mt-0.5">☀ Solar panels</div>
                    )}
                    <details className="mt-1">
                      <summary className="text-[10px] text-blue-700 cursor-pointer">Reasons</summary>
                      <ul className="text-[10px] text-gray-700 mt-1 space-y-0.5">
                        {b.reasons.map((r, j) => (
                          <li key={j}>{r}</li>
                        ))}
                      </ul>
                    </details>
                    <div className="flex gap-1 mt-1">
                      <a
                        href={`https://www.google.com/maps?q=${b.center.latitude},${b.center.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-blue-700 hover:underline"
                      >
                        Map
                      </a>
                      <a
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${b.center.latitude},${b.center.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-blue-700 hover:underline"
                      >
                        Street
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Final candidates (post verification) */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-3">Final Candidates (after Street View verification) — {candidates.length}</h2>
        {candidates.length === 0 ? (
          <p className="text-xs text-gray-400">No candidates passed verification.</p>
        ) : (
          <div className="space-y-3">
            {candidates.map((c: any, i: number) => (
              <div key={c.id} className="border border-gray-200 rounded p-3 text-xs">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">#{i + 1} {c.address}</p>
                    <p className="text-gray-500">
                      {c.latitude?.toFixed(6)}, {c.longitude?.toFixed(6)} — {c.confidence_score}% ({c.confidence_level})
                    </p>
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`}
                    target="_blank"
                    className="text-blue-700 hover:underline"
                  >
                    Map &#8599;
                  </a>
                </div>
                {c.ai_explanation && (
                  <p className="text-gray-700 mt-2 italic">"{c.ai_explanation}"</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Raw data */}
      <details className="rounded-lg border border-gray-200 bg-white p-4">
        <summary className="font-bold cursor-pointer text-xs">Raw search data (for deep debugging)</summary>
        <pre className="bg-gray-50 rounded p-3 text-[11px] overflow-x-auto mt-3">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
