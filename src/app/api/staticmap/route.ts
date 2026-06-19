import { NextRequest, NextResponse } from "next/server";

/**
 * Server-proxied Google Static Map with numbered markers. The interactive
 * `output=embed` iframe is blocked by Google now, but the Static Maps API
 * renders reliably (same key we use for satellite tiles) and supports multiple
 * labelled pins. Query: repeated `m=lat,lng,label`; optional `confirmed=1`.
 */
export async function GET(request: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no key" }, { status: 500 });

  const pts = request.nextUrl.searchParams.getAll("m");
  if (pts.length === 0) return NextResponse.json({ error: "no points" }, { status: 400 });
  const confirmed = request.nextUrl.searchParams.get("confirmed") === "1";

  const color = confirmed ? "0x2f6b4f" : "0xa8442a";
  const markers = pts
    .map((m) => {
      const [lat, lng, label] = m.split(",");
      const lbl = label && /^[A-Za-z0-9]$/.test(label) ? `label:${label}|` : "";
      return `markers=${encodeURIComponent(`color:${color}|${lbl}${lat},${lng}`)}`;
    })
    .join("&");

  const url =
    `https://maps.googleapis.com/maps/api/staticmap?size=640x360&scale=2&maptype=roadmap&${markers}&key=${apiKey}`;

  try {
    const r = await fetch(url);
    if (!r.ok) return NextResponse.json({ error: `maps ${r.status}` }, { status: 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": r.headers.get("content-type") || "image/png", "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }
}
