import { NextRequest, NextResponse } from "next/server";
import { SUBURBS } from "@/lib/suburb-data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const suburb = SUBURBS.find((s) => s.name.toLowerCase() === name.toLowerCase());

  if (!suburb) {
    return NextResponse.json({ error: "Suburb not found" }, { status: 404 });
  }

  // Redirect to a Google Maps URL showing the bounding box
  const centerLat = (suburb.north + suburb.south) / 2;
  const centerLng = (suburb.east + suburb.west) / 2;

  // Use a bounding box URL that shows the area
  const mapsUrl = `https://www.google.com/maps/@${centerLat},${centerLng},15z`;

  return NextResponse.redirect(mapsUrl);
}
