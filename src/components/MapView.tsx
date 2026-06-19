"use client";

interface Waypoint {
  address: string;
  lat: number;
  lng: number;
  confirmed?: boolean;
}

interface Props {
  candidates: Waypoint[];
}

const LABELS = "123456789ABCDEFG";

export default function MapView({ candidates }: Props) {
  if (!candidates || candidates.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-line bg-paper text-sm text-muted">
        No addresses to map
      </div>
    );
  }

  // If a candidate is confirmed, show only that; otherwise the top 10.
  const confirmedOnly = candidates.filter((c) => c.confirmed);
  const shown = (confirmedOnly.length ? confirmedOnly : candidates).slice(0, 10);
  const isConfirmed = confirmedOnly.length > 0;

  const mapSrc =
    "/api/staticmap?" +
    shown.map((c, i) => `m=${c.lat},${c.lng},${LABELS[i]}`).join("&") +
    (isConfirmed ? "&confirmed=1" : "");

  const cleanAddr = (a: string) => a.replace(/, South Africa$/, "");
  const streetviewUrl = (c: Waypoint) => `https://www.google.com/maps?q=&layer=c&cbll=${c.lat},${c.lng}`;
  const mapUrl = (c: Waypoint) => `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;
  // Drive-by route through the shown pins
  const routeUrl =
    `https://www.google.com/maps/dir/` + shown.map((c) => encodeURIComponent(`${c.lat},${c.lng}`)).join("/");

  return (
    <div className="rounded-xl border border-line bg-card p-4 flex flex-col gap-3">
      <div className="flex justify-between items-center gap-3">
        <h3 className="data-label">{isConfirmed ? "Confirmed location" : `Top ${shown.length} on map`}</h3>
        <a
          href={routeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-clay hover:text-clay transition-colors"
        >
          Drive-by route ↗
        </a>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mapSrc}
        alt="Candidate locations"
        className="w-full rounded-lg border border-line"
        style={{ aspectRatio: "640 / 360", objectFit: "cover" }}
      />

      <ul className="space-y-1">
        {shown.map((c, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-ink">
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-card"
              style={{ background: isConfirmed ? "#2f6b4f" : "#a8442a" }}
            >
              {LABELS[i]}
            </span>
            <a href={streetviewUrl(c)} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-clay flex-1 truncate">
              {cleanAddr(c.address)}
            </a>
            <a href={mapUrl(c)} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-clay" title="View on map">
              📍
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
