"use client";

interface Waypoint {
  address: string;
  lat: number;
  lng: number;
}

interface Props {
  candidates: Waypoint[];
  origin?: string;
}

export default function MapView({ candidates, origin = "Pretoria+East,+Gauteng" }: Props) {
  if (!candidates || candidates.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
        No addresses to map
      </div>
    );
  }

  // Build Google Maps drive-by route URL
  const waypoints = candidates
    .map((c) => encodeURIComponent(`${c.lat},${c.lng}`))
    .join("/");
  const destination = candidates[candidates.length - 1];
  const mapsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(origin)}/${waypoints}`;

  const streetviewUrl = (c: Waypoint) =>
    `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.lat},${c.lng}`;

  // Center the map on the first candidate
  const centerLat = candidates.reduce((s, c) => s + c.lat, 0) / candidates.length;
  const centerLng = candidates.reduce((s, c) => s + c.lng, 0) / candidates.length;

  // Build a Google Maps embed URL with markers (uses search mode with coords)
  const embedUrl = `https://www.google.com/maps?q=${centerLat},${centerLng}&z=15&output=embed`;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-900">All {candidates.length} candidates on map</h3>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 transition-colors"
        >
          <span>Drive-by route</span>
          <span aria-hidden="true">&#8599;</span>
        </a>
      </div>

      {/* Embedded map */}
      <div className="w-full rounded-lg overflow-hidden border border-gray-200" style={{ height: 300 }}>
        <iframe
          src={embedUrl}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Candidate locations"
        />
      </div>

      <ul className="space-y-1 mt-1">
        {candidates.map((c, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-gray-700">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold">
              {i + 1}
            </span>
            <a
              href={streetviewUrl(c)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline text-blue-700 flex-1"
            >
              {c.address}
            </a>
            <a
              href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-blue-700"
              title="View on map"
            >
              📍
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
