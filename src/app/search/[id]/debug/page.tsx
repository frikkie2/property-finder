"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function DebugPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<any>(null);

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

  return (
    <div className="max-w-4xl mx-auto p-5 space-y-6">
      <div>
        <a href={`/search/${id}`} className="text-xs text-blue-700 hover:underline">&larr; Back to search results</a>
        <h1 className="text-lg font-bold mt-2">Diagnostic View</h1>
        <p className="text-xs text-gray-500">Status: <span className="font-mono">{data.status}</span></p>
        {data.errorMessage && (
          <p className="mt-2 rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            Error: {data.errorMessage}
          </p>
        )}
      </div>

      {/* Listing summary */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-2">1. Listing Data Extracted from Property24</h2>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><strong>Suburb:</strong> {listing.listedSuburb || "—"}</div>
          <div><strong>Price:</strong> {listing.price ? `R${(listing.price / 1000000).toFixed(2)}M` : "—"}</div>
          <div><strong>Beds:</strong> {listing.bedrooms ?? "—"}</div>
          <div><strong>Baths:</strong> {listing.bathrooms ?? "—"}</div>
          <div><strong>Plot:</strong> {listing.plotSize ? `${listing.plotSize}m²` : "—"}</div>
          <div><strong>Floor:</strong> {listing.floorSize ? `${listing.floorSize}m²` : "—"}</div>
          <div><strong>Agent:</strong> {listing.agentName || "—"}</div>
          <div><strong>Agency:</strong> {listing.agencyName || "—"}</div>
        </div>
        {listing.description && (
          <div className="mt-3">
            <strong className="text-xs">Description:</strong>
            <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{listing.description}</p>
          </div>
        )}
      </section>

      {/* Listing photos */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-2">2. Listing Photos ({listing.photoUrls?.length || 0})</h2>
        <p className="text-xs text-gray-500 mb-3">These are the photos the AI analysed.</p>
        <div className="grid grid-cols-3 gap-2">
          {(listing.photoUrls || []).map((url: string, i: number) => (
            <div key={i} className="relative aspect-video rounded overflow-hidden border border-gray-200">
              <img
                src={`/api/proxy-image?url=${encodeURIComponent(url)}`}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
              />
              <span className="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">#{i + 1}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Fingerprint */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-2">3. AI-Extracted Fingerprint</h2>
        <p className="text-xs text-gray-500 mb-3">What the AI identified about the property. If this is wrong, matching will fail.</p>
        {!fingerprint || Object.keys(fingerprint).length === 0 ? (
          <p className="text-xs text-gray-400">No fingerprint extracted yet.</p>
        ) : (
          <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto">
            {JSON.stringify(fingerprint, null, 2)}
          </pre>
        )}
      </section>

      {/* Candidates */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-2">4. Candidates Found ({candidates.length})</h2>
        {candidates.length === 0 ? (
          <p className="text-xs text-gray-400">No candidates found. Possible reasons:
            <br/>• AI extracted wrong features from the photos (check fingerprint above)
            <br/>• Suburb bounds in our data don't match actual Silverton area
            <br/>• Solar API has no coverage for this area
            <br/>• Tile scan prompt too strict
          </p>
        ) : (
          <div className="space-y-3">
            {candidates.map((c: any, i: number) => (
              <div key={c.id} className="border border-gray-200 rounded p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-sm">#{i + 1} {c.address}</p>
                    <p className="text-xs text-gray-500">
                      {c.latitude?.toFixed(6)}, {c.longitude?.toFixed(6)} — Confidence: {c.confidence_score}% ({c.confidence_level})
                    </p>
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`}
                    target="_blank"
                    className="text-xs text-blue-700 hover:underline"
                  >
                    View on Maps &#8599;
                  </a>
                </div>
                {c.ai_explanation && (
                  <p className="text-xs text-gray-700 mt-2 italic">"{c.ai_explanation}"</p>
                )}
                {c.feature_matches && c.feature_matches.length > 0 && (
                  <ul className="mt-2 text-xs space-y-0.5">
                    {c.feature_matches.slice(0, 5).map((f: any, j: number) => (
                      <li key={j} className={f.matched ? "text-green-700" : "text-red-600"}>
                        {f.matched ? "✓" : "✗"} {f.feature} <span className="text-gray-400">({f.source})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Suburb bounds */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-bold mb-2">5. Search Area (Suburb Bounds)</h2>
        <p className="text-xs text-gray-500 mb-2">
          The suburb bounds we use to define the search area. If these are wrong, we're scanning the wrong part of the map.
        </p>
        <a
          href={`/api/debug/suburb-bounds/${listing.listedSuburb}`}
          target="_blank"
          className="text-xs text-blue-700 hover:underline"
        >
          View {listing.listedSuburb} bounds on Google Maps
        </a>
      </section>

      {/* Raw data */}
      <details className="rounded-lg border border-gray-200 bg-white p-4">
        <summary className="font-bold cursor-pointer">6. Raw Search Data (for debugging)</summary>
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto mt-3">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
