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

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-gray-900">Drive-by route</h3>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 transition-colors w-fit"
      >
        <span>Open in Google Maps</span>
        <span aria-hidden="true">&#8599;</span>
      </a>
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
              className="hover:underline text-blue-700"
            >
              {c.address}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
